"use strict";

const {Component, AsyncEmitter, async, utils} = require("merapi");
const pack = require("../package");
const {Router} = require("express");
const request = require("request-promise");

class ServiceSub extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();

        this.VERSION = pack.version;
        this.NOTIFY_INTERVAL = config.default("service.notify_interval", 10000);
        this.SERVICE_NAME = config.default("name", "unnamed-service");
        this.HOST = config.default("service.cluster_hostname", config.default("service.host", config("name")));
        this.PORT = config.default("service.port", 5000);

        this.injector = injector;
        this.config = config;
        this.logger = logger;

        this._status = "ok";
        this._router = Router();
        this._subscriptions = {};
        this._registry = {};
        this._hooks = [];
        this._intervalId = null;
    }

    *initialize() {
        let desc = this.config.default("service.subscribe", {});
        for (let i in desc) {
            this._subscriptions[i] = {};
            for (let event in desc[i]) {
                let hook = i + "." + event;
                let method = yield this.injector.resolveMethod(desc[i][event]);
                this._subscriptions[i][event] = { hook, method };
                this._hooks.push(hook);
                this.createHook(hook, method);
            }
        }
        Object.assign(this._registry, this.config.default("service.registry", {}));
    }

    resolve(name) {
        return this._registry[name] || "http://" + name + ":5000";
    }

    updateSubscriptions() {
        for (let service in this._subscriptions) {
            for (let event in this._subscriptions[service]) {
                let hook = this._subscriptions[service][event].hook;
                this.updateSubscription(service, event, hook);
            }
        }
    }

    updateSubscription(service, event, hook) {
        return request({
            uri: this.resolve(service) + "/events/" + event + "/subscribe",
            method: "POST",
            body: {
                uri: this.HOST + ":" + this.PORT,
                service: this.SERVICE_NAME,
                hook: hook
            },
            json: true
        }).catch(e => {
            this.logger.warn("Cannot update subscription to :" + service, e);
        });
    }

    createHook(name, method) {
        this._router.post("/" + name, async(function* (req, res) {
            let payload = req.body;
            try {
                let ret = method(payload);
                if (utils.isPromise(ret))
                    yield ret;
                res.json({
                    status: "ok"
                });
            } catch (e) {
                this.logger.error(`Error triggering hook ${name}`, e);
                res.json({
                    status: "error",
                    error: e.toString()
                });
            }
        }).bind(this));
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
            hooks: this._hooks
        };
    }

    getHookList() {
        return this._hooks;
    }

    *mount(service) {
        service.addEndpoint("hooks", this._router);
        if (this._intervalId)
            clearInterval(this._intervalId);
        this._intervalId = setInterval(this.updateSubscriptions.bind(this), this.NOTIFY_INTERVAL);
    }

    *unmount(service) {
        service.removeEndpoint("hooks");
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

}

module.exports = ServiceSub;