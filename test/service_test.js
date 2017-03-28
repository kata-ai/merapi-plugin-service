"use strict";

const chai = require("chai");
const expect = chai.expect;
const request = require("supertest");

const merapi = require("merapi");
const component = require("merapi/component");
const asyn = require("merapi/async");

/* eslint-env mocha */

describe("Merapi Plugin Service: API", function () {
    let container = {};
    let service = {};

    before(asyn(function* () {
        container = merapi({
            basepath: __dirname,
            config: {
                name: "test",
                version: "1.0.0",
                main: "mainCom",
                service: {
                    "api": {
                        "v1": {
                            "getCustomer": "mainCom.getCustomer",
                            "createCustomer": "mainCom.createCustomer"
                        },
                        "v2": {
                            "getCustomer": "mainCom.getCustomerV2"
                        }
                    },
                    "publish": {
                        "message_incoming": "triggerMessageIncoming"
                    },
                    "subscribe": {
                        "yb-core": {
                            "incoming_message": "mainCom.handleIncomingMessage"
                        }
                    },
                    "registry": {
                        "yb-core": "http://localhost:5555"
                    },
                    "port": 5000
                }
            }
        });

        container.registerPlugin("service", require("../index.js")(container));
        container.register("mainCom", class MainCom extends component {
            constructor(logger) {
                super();
                this.logger = logger;
            }

            getCustomer(...params) {
                return { param: params };
            }

            createCustomer(...params) {
                return { param: params };
            }

            getCustomerV2(...params) {
                return { param: params };
            }

            createCustomerV2(...params) {
                return { param: params };
            }

            handleIncomingMessage() { }

            start() { }
        });

        yield container.start();
        this.timeout(5000);

        service = yield container.resolve("service");
    }));

    after(asyn(function* () {
        yield container.stop();
    }));

    describe("Service plugin", function () {
        it("should return service info", asyn(function* () {
            let body, matcher = /\d+.\d+.\d+/;
            yield request(service._express)
                .get("/info")
                .expect(200)
                .expect(function (res) {
                    body = res.body;
                });

            expect(body.modules.api.version).to.match(matcher);
            expect(body.modules.pub.version).to.match(matcher);
            expect(body.modules.sub.version).to.match(matcher);
            expect(body.api.v1).to.deep.equal(["getCustomer", "createCustomer"]);
            expect(body.api.v2).to.deep.equal(["getCustomer"]);
            expect(body.events).to.deep.equal(["message_incoming"]);
            expect(body.hooks).to.deep.equal(["yb-core.incoming_message"]);
        }));

        it("should resolve all components", asyn(function* () {
            expect(yield container.resolve("mainCom")).to.not.be.null;
            expect(yield container.resolve("triggerMessageIncoming")).to.not.be.null;
        }));

        describe("get module info", function () {
            it("should return module info if module is available", asyn(function* () {
                let body;

                yield request(service._express)
                    .get("/modules/api/info")
                    .expect(function (res) {
                        body = res.body;
                    });

                expect(body.version).to.match(/\d+.\d+.\d+/);
                expect(body.status).to.equal("ok");
            }));

            it("should return 404 if module is unavailable", function (done) {
                let expectedResponse = "Not found";
                request(service._express)
                    .get("/modules/absent_api/info")
                    .expect(404, expectedResponse, done);
            });
        });

        describe("get module extension", function () {
            it("should return module extension if module is available", function (done) {
                let expectedResponse = {
                    api: {
                        v1: ["getCustomer", "createCustomer"],
                        v2: ["getCustomer"]
                    }
                };
                request(service._express)
                    .get("/modules/api/extension")
                    .expect(200, expectedResponse, done);
            });

            it("should return 404 if module is unavailable", function (done) {
                let expectedResponse = "Not found";
                request(service._express)
                    .get("/modules/absent_api/extension")
                    .expect(404, expectedResponse, done);
            });
        });
    });

});




