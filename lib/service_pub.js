"use strict";

const {Component, AsyncEmitter} = require("merapi");
const {Router} = require("express");
const request = require("request-promise");

const pack = require("../package");


function createRedisInstance(config) {
    const redis = require("redis");
    return redis.createClient("redis://"
        + config("host") + ":"
        + config("port"), {
            retry_strategy: (options) => {
                if (options.error.code === "ECONNREFUSED") {
                    // End reconnecting on a specific error and flush all commands with a individual error
                    return new Error("The server refused the connection");
                }
                if (options.total_retry_time > config.default("max_retry_time", 1000 * 60 * 60)) {
                    // End reconnecting after a specific timeout and flush all commands with a individual error
                    return new Error("Retry time exhausted");
                }
                if (options.times_connected > config.default("max_times_connected", 10)) {
                    // End reconnecting with built in error
                    return undefined;
                }
                // reconnect after
                return Math.max(options.attempt * config.default("max_attemps", 100),
                    config.default("reconnect_delay", 3000));
            }
        }
    );
}

class ServicePub extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();

        this.VERSION = pack.version;
        this.SUBSCRIBER_EXPIRE = config.default("service.subcriber_expire", 30000);
        this.UPDATE_INTERVAL = config.default("service.publisher_update_interval", 5000);

        this.injector = injector;
        this.config = config;
        this.logger = logger;
        this._status = "ok";
        this._router = Router();
        this._subscribers = {};
        this._eventList = [];
        this._intervalId = null;
    }

    *initialize() {
        let desc = this.config.default("service.publish", {});
        for (let i in desc) {
            this._eventList.push(i);
            this._subscribers[i] = [];
            this.createPublisher(i, desc[i]);
        }
        this._setupRoutes();
        this._setupRedis();
    }

    _setupRedis() {
        if (this.config.has("service.redis")) {
            let redisConfig = this.config.path("service.redis");
            this._enablePeerNotification = true;
            this._redisPub = createRedisInstance(redisConfig);
            this._redisSub = createRedisInstance(redisConfig);
            this._redisChannel = this.config("name") + ".service-pub";

            this._redisSub.subscribe(this._redisChannel, (channel, message) => {
                if (channel === this._redisChannel) {
                    try {
                        let {command, params} = JSON.parse(message);
                        switch (command) {
                            case "subscribe":
                                return this.subscribe(...params);
                            case "unsubscribe":
                                return this.unsubscribe(...params);
                        }
                    } catch (e) {
                        this.logger.error("Error parsing redis message", e);
                    }
                }
            });
        }
    }

    _setupRoutes() {
        let eventSubscribe = (req, res) => {
            var info = req.body;
            var event = req.params.event;
            if (this._subscribers[event]) {
                this.subscribe(event, info, true);
                res.json({ status: "ok" });
            } else {
                res.json({ status: "error", error: "Event doesn't exist" });
            }
        };

        let eventUnsubscribe = (req, res) => {
            var info = req.body;
            var event = req.params.event;
            if (this._subscribers[event]) {
                this.unsubscribe(event, info, true);
                res.json({ status: "ok" });
            } else {
                res.json({ status: "error", error: "Event doesn't exist" });
            }
        };

        this._router.post("/:event/subscribe", eventSubscribe.bind(this));
        this._router.post("/:event/unsubscribe", eventUnsubscribe.bind(this));
    }

    notifyPeers(command, params) {
        if (this._redisPub && this._enablePeerNotification) {
            this._redisPub.publish(this._redisChannel, JSON.stringify({ command: command, params: params }));
        }
    }

    createPublisher(event, triggerName) {
        let trigger = (payload) => {
            return trigger.publish(payload);
        };
        trigger.publish = (payload) => {
            return this.triggerEvent(event, payload);
        };
        this.injector.register(triggerName, trigger, true);
    }

    subscribe(event, info, notify) {
        if (!this._subscribers[event])
            return this.logger.warn("cannot subscribe to undefined event %s", event);
        var srv = this._subscribers[event].find(function (o) {
            return o.service == info.service && o.hook == info.hook;
        });
        if (!srv) {
            srv = {
                service: info.service,
                uri: info.uri,
                hook: info.hook,
                timestamp: Date.now()
            };
            this._subscribers[event].push(srv);
        } else {
            srv.uri = info.uri;
            srv.timestamp = Date.now();
        }
        this.emit("subscribe", event, info, notify);
        if (notify)
            this.notifyPeers("subscribe", [event, info]);
    }

    unsubscribe(event, info, notify) {
        if (!this._subscribers[event])
            return;
        this._subscribers[event] = this._subscribers[event].filter(o => !(o.service == info.service && o.hook == info.hook));
        this.emit("unsubscribe", event, info, notify);
        if (notify)
            this.notifyPeers("unsubscribe", [event, info]);
    }

    updateSubscribers() {
        for (var event in this._subscribers) {
            this._subscribers[event] = this._subscribers[event].filter(sub => (Date.now() - sub.timestamp) < this.SUBSCRIBER_EXPIRE);
        }
    }

    *triggerEvent(event, payload) {
        let subs = this._subscribers[event];
        if (!subs)
            return this.logger.warn(`cannot trigger undefined event: ${event}`);
        this.emit("trigger", event, payload);
        yield subs.map(sub => {
            return this.emitEvent(sub, payload).catch((e) => {
                this.logger.error("error triggering event", e);
                this.logger.info({ hook: { name: sub.service, uri: sub.uri, hook: sub.hook } },
                    "unreachable hook: unsubscribing");
                this.unsubscribe(event, sub);
            });
        });
    }

    emitEvent(sub, payload) {
        return request({
            uri: "http://" + sub.uri + "/hooks/" + sub.hook,
            method: "POST",
            body: {
                payload: payload
            },
            json: true
        }).then((ret) => {
            if (ret.status == "error")
                this.logger.error({
                    hook: {
                        service: sub.service,
                        uri: sub.uri,
                        hook: sub.hook
                    }
                }, ret.error);
            return ret;
        });
    }

    info() {
        return {
            version: this.VERSION,
            status: this._status
        };
    }

    status() {
        return this._status;
    }

    extension() {
        return {
            events: this._eventList
        };
    }

    getEventList() {
        return this._eventList;
    }

    *mount(service) {
        yield service.addEndpoint("events", this._router);
        if (this._intervalId)
            clearInterval(this._intervalId);
        this._intervalId = setInterval(this.updateSubscribers.bind(this), this.UPDATE_INTERVAL);
    }

    *unmount(service) {
        yield service.removeEndpoint("events");
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}

module.exports = ServicePub;