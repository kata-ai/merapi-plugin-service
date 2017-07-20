"use strict";

const { Component, AsyncEmitter } = require("merapi");
const { Router } = require("express");
const request = require("request-promise");

const pack = require("../package");

class ServicePubQueue extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();

        this.VERSION = pack.version;

        this.injector = injector;
        this.config = config;
        this.logger = logger;
        this._status = "ok";
        this._router = Router();
        this._registry = {};
        this._subscribers = {};
    }

    *initialize() {
        let desc = this.config.default("service.queue.publish", {});

        for (let service in desc) {
            this._subscribers[service] = [];

            for (let event in desc[service]) {
                this._subscribers[service].push(event);
                let componentName = desc[service][event];
                this.createPublisher(service, event, componentName);
            }
        }

        Object.assign(this._registry, this.config.default("service.registry", {}));
    }

    resolve(name) {
        return this._registry[name] || "http://" + name + ":5000";
    }

    createPublisher(service, event, componentName) {
        let component = (payload) => {
            return component.publish(payload);
        };

        component.publish = (payload) => {
            return this.triggerEvent(service, event, payload);
        };

        this.injector.register(componentName, component, true);
    }

    *triggerEvent(service, event, payload) {
        let subs = this._subscribers[service];
        this.emit("triggerQueue", service, event, payload);

        return subs.map(sub => {
            return this.emitEvent(service, event, payload)
                .catch(e => {
                    this._subscribers[service] = subs.filter(s => s != sub);
                });
        })
    }

    emitEvent(service, event, payload) {
        return request({
            uri: this.resolve(service) + "/queue-hooks/" + event,
            method: "POST",
            body: { payload },
            json: true
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
        return {};
    }

    *mount() { }

    *unmount() { }
}

module.exports = ServicePubQueue;