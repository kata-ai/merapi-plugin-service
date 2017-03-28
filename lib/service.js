"use strict";

const {Component, AsyncEmitter} = require("merapi");
const express = require("express");
const bodyParser = require("body-parser");
const bearerToken = require("express-bearer-token");

class Service extends Component.mixin(AsyncEmitter) {

    constructor(config, logger, injector) {
        super();
        this.config = config;
        this.logger = logger;
        this.injector = injector;

        this._version = config.default("version", "1.0.0");
        this._name = config.default("name", config.default("package.name", "unnamed-service"));
        this._modules = {};
        this._endpoints = {};
        this._express = express();
        this._express.use(bodyParser.urlencoded({ extended: true }));
        this._express.use(bodyParser.json());
        this._secret = config.default("service.secret", null);

        if (this._secret) {
            this._express.use(bearerToken({
                bodyKey: "apikey",
                queryKey: "apikey",
                headerKey: "Bearer",
                reqKey: "apikey"
            }));

            this._express.use((req, res, next) => {
                if (req.apikey !== this._secret)
                    return res.status(401).end("Unauthorized");
                next();
            });
        }

        this._middlewareRouter = express.Router();
        this._express.use(this._middlewareRouter);
    }

    *addEndpoint(name, handler) {
        yield this.emit("beforeEndpointAdded", name, handler, this);
        if (!this._endpoints[name]) {
            this._endpoints[name] = {};
            this._express.use("/" + name, (req, res, next) => {
                if (this._endpoints[name].handler)
                    return this._endpoints[name].handler(req, res, next);
                else
                    return next();
            });
        }
        this._endpoints[name].handler = handler;
        yield this.emit("afterEndpointAdded", name, handler, this);
    }

    *removeEndpoint(name) {
        yield this.emit("beforeEndpointRemoved", name, this);
        if (this._endpoints[name])
            this._endpoints[name].handler = null;
        yield this.emit("afterEndpointRemoved", name, this);
    }

    *initialize() {
        this._setupInfoEndpoint();
        this._setupModulesEndpoint();
    }

    _setupInfoEndpoint() {
        let self = this;
        this._express.use("/info", function (req, res) {
            res.json(self.info({ all: true }));
        });
    }

    _setupModulesEndpoint() {
        let self = this;
        this._express.use("/modules/:module/info", function (req, res) {
            let mod = req.params.module;
            if (self._modules[mod])
                res.json(self._modules[mod].component.info());
            else
                res.status(404).send("Not found");
        });

        this._express.use("/modules/:module/extension", function (req, res) {
            let mod = req.params.module;
            if (self._modules[mod])
                res.json(self._modules[mod].component.extension());
            else
                res.status(404).send("Not found");
        });
    }

    status() {
        let stats = Object.keys(this._modules).map(module => this._modules[module].component.status());
        return stats.every(s => s == "ok") ? "ok" : "failure";
    }

    addMiddleware(middleware) {
        this._middlewareRouter.use(middleware);
    }

    info() {
        let inf = {
            name: this._name,
            version: this._version,
            status: this.status()
        };

        inf.modules = this.getModulesInfo();
        let exts = this.getModulesExtension();
        for (let i in exts) {
            if (!inf[i])
                inf[i] = exts[i];
        }

        return inf;
    }

    getModulesInfo() {
        return Object.keys(this._modules).reduce((info, name) => {
            info[name] = this._modules[name].component.info();
            return info;
        }, {});
    }

    getModulesExtension() {
        return Object.keys(this._modules).reduce((ext, name) => {
            Object.assign(ext, this._modules[name].component.extension());
            return ext;
        }, {});
    }

    hasModule(name) {
        return !!this._modules[name];
    }

    getModule(name) {
        return this._modules[name] ? this._modules[name].component : null;
    }

    handleModuleUpdate(name, info) {
        this.emit("update", name, info);
    }

    *addModule(name, module) {
        if (typeof module === "string")
            module = yield this.injector.resolve(module);
        yield this.emit("beforeAddModule", name, module, this);
        if (this.hasModule(name))
            throw new Error(`Module ${name} already register. Use replaceModule() to replace a module.`);
        let listenerId = module.on("update", this.handleModuleUpdate.bind(this, name));
        this._modules[name] = { component: module, listenerId };
        yield this.emit("beforeMount", name, module, this);
        yield module.mount(this);
        yield this.emit("afterMount", name, module, this);
        yield this.emit("afterAddModule", name, module, this);
    }

    *replaceModule(name, module) {
        if (typeof module === "string")
            module = yield this.injector.resolve(module);
        yield this.emit("beforeReplaceModule", name, module, this);
        yield this.removeModule(name);
        yield this.addModule(name, module);
        yield this.emit("afterReplaceModule", name, module, this);
    }

    *removeModule(name) {
        if (this.hasModule(name)) {
            yield this.emit("beforeRemoveModule", name, this);
            this._modules[name].component.removeListener(this._modules[name].listenerId);
            yield this._modules[name].component.unmount(this._endpoint);
            delete this._modules[name];
            yield this.emit("afterRemoveModule", name);
        }
    }

    *start() {
        yield this.emit("beforeStart", this);
        const host = this.config.default("service.host", "0.0.0.0");
        const port = this.config.default("service.port", 5000);
        this.__listen = this._express.listen(port, host, () => {
            this.logger.info(`${this._name}@${this._version} service running on ${host}:${port} in ${this.config.env} mode`);
            this.emit("afterStart", this);
        });
    }

    *stop() {
        if (this.__listen) {
            yield this.emit("beforeStop", this);
            this.__listen.close(() => {
                this.emit("afterStop", this);
            });

        }
    }
}

module.exports = Service;