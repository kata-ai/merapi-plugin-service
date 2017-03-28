"use strict";

const {Component, AsyncEmitter, async} = require("merapi");
const pack = require("../package");
const {Router} = require("express");
const snake = require("to-snake-case");

function getPreviousVersion(version) {
    let v = parseInt(version.substring(1));
    return v > 1 ? v - 1 : null;
}

class ServiceApi extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();
        this.injector = injector;
        this.config = config;
        this.logger = logger;
        this._version = pack.version;
        this._status = "ok";
        this._api = {};
        this._descriptor = {};
        this._router = Router();
    }

    *initialize() {
        let apiDesc = this.config.default("service.api", {});

        for (let v in apiDesc) {
            this._api[v] = {};
            this._descriptor[v] = [];
            let prev = getPreviousVersion(v);
            if (prev && this._api["v" + prev])
                this._api[v] = Object.assign(this._api[v], this._api["v" + prev]);
            for (let i in apiDesc[v]) {
                this._api[v][i] = yield this.injector.resolveMethod(apiDesc[v][i]);
                this._descriptor[v].push(i);
            }
        }

        for (let v in this._api) {
            for (let i in this._api[v])
                this.createApiHandler(v, i);
        }
    }

    createApiHandler(version, method) {
        let path = "/" + version + "/" + snake(method);
        this._router.post(path, async(function* (req, res) {
            let params = req.body.params;
            try {
                let ret = yield this.callApi(version, method, params);
                res.json({ status: "ok", result: ret });
            } catch (e) {
                this.logger.error("Failed to trigger api: " + path, e);
                res.json({ status: "error", error: e.toString });
            }
        }).bind(this));
    }

    *callApi(version, method, params) {
        let fn = this._api[version][method];
        let ret = fn.apply(null, params);
        if (ret && typeof ret.then == "function")
            ret = yield ret;
        return ret;
    }

    getApiList(version) {
        if (!this._api[version])
            return null;
        return Object.keys(this._api[version]);
    }

    info() {
        return {
            version: this._version,
            status: this._status
        };
    }

    status() {
        return this._status;
    }

    extension() {
        return {
            api: this._descriptor
        };
    }

    *mount(service) {
        service.addEndpoint("api", this._router);
    }

    *unmount(service) {
        service.removeEndpoint("api");
    }

}

module.exports = ServiceApi;