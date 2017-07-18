"use strict";

const { Component, AsyncEmitter, async, utils } = require("merapi");
const pack = require("../package");
const { Router } = require("express");

class ServiceSubQueue extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();

        this.VERSION = pack.version;
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
        this._queue = [];
    }

    *initialize() {
        let desc = this.config.default("service.queue.subscribe", {});

        for (let event in desc) {
            let method = yield this.injector.resolveMethod(desc[event]);
            this._hooks.push(event);

            this.createHook(event, method);
        }

    }

    createHook(name, method) {
        this._router.post("/" + name, async(function* (req, res) {
            let payload = req.body;
            this._queue.push({ payload, method });

            yield this.process();

            res.json({
                status: "ok"
            });
        }).bind(this));
    }

    *process() {
        if (this._processing)
            return;

        if (this._queue.length == 0)
            return;

        this._processing = true;

        try {
            let { payload, method } = this._queue.shift();

            let ret = method(payload);
            if (utils.isPromise(ret))
                yield ret;

        } catch (e) {
            this.logger.error(`Error processing ${name}`, e);
        }

        this._processing = false;
        process.nextTick(yield this.process());
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
            queueHooks: this._hooks
        };
    }

    getQueueHookList() {
        return this._hooks;
    }

    *mount(service) {
        service.addEndpoint("queue-hooks", this._router);
    }

    *unmount(service) {
        service.removeEndpoint("queue-hooks");
    }

}

module.exports = ServiceSubQueue;