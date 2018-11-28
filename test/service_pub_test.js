"use strict";

const chai = require("chai");
const expect = chai.expect;
const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const sleep = require("sleep-promise");

const merapi = require("merapi");
const component = require("merapi/component");
const asyn = require("merapi/async");

/* eslint-env mocha */

describe("Merapi Plugin Service: Publisher", function () {
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
                    "publish": {
                        "message_incoming": "triggerMessageIncoming"
                    },
                    "publisher_update_interval": 10,
                    "subcriber_expire": 50,
                    "port": 5002
                }
            }
        });

        container.registerPlugin("service", require("../index.js")(container));
        container.register("mainCom", class MainCom extends component {
            start() { }
        });

        yield container.start();
        this.timeout(5000);

        service = yield container.resolve("service");
    }));

    after(function () {
        container.stop();
    });

    describe("getEventList", function () {
        it("should return event list", function () {
            let servicePub = service.getModule("pub");
            let expectedPub = ["message_incoming"];
            expect(servicePub.getEventList()).to.deep.equal(expectedPub);
        });
    });

    describe("event subscription", function () {
        describe("when event exists", function () {
            it("should return ok", function (done) {
                let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                let expectedResponse = { status: "ok" };
                request(service._express).post("/events/message_incoming/subscribe")
                    .set("Accept", "application/json")
                    .send(payload)
                    .expect(200, expectedResponse, done);
            });

            it("should push subscriber detail to _subscribers", function () {
                let servicePub = service.getModule("pub");
                let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                let subscriber = servicePub._subscribers["message_incoming"][0];
                delete subscriber["timestamp"];
                expect(subscriber).to.deep.equal(payload);
            });
        });

        describe("when event doesn't exist", function () {
            it("should return error", function (done) {
                let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                let expectedResponse = { status: "error", error: "Event doesn't exist" };
                request(service._express).post("/events/absent_event/subscribe")
                    .set("Accept", "application/json")
                    .send(payload)
                    .expect(200, expectedResponse, done);
            });
        });

        describe("when subscription expired", function () {
            it("should remove subscriber detail from _subscribers", asyn(function* () {
                let servicePub = service.getModule("pub");
                let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                let expectedResponse = { status: "ok" };
                yield request(service._express).post("/events/message_incoming/subscribe")
                    .set("Accept", "application/json")
                    .send(payload)
                    .expect(200, expectedResponse);

                let subscriber = servicePub._subscribers["message_incoming"][0];
                delete subscriber["timestamp"];
                expect(subscriber).to.deep.equal(payload);

                yield sleep(100);
                expect(servicePub._subscribers["message_incoming"]).to.be.empty;
            }));
        });
    });

    describe("event unsubscription", function () {
        describe("when event exists", function () {
            describe("when subscriber doesn't exist", function () {
                it("should return ok", function (done) {
                    let payload = { service: "absentServiceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                    let expectedResponse = { status: "ok" };

                    request(service._express).post("/events/message_incoming/unsubscribe")
                        .set("Accept", "application/json")
                        .send(payload)
                        .expect(200, expectedResponse, done);
                });

                it("should not remove subscriber detail from _subscribers", asyn(function* () {
                    let servicePub = service.getModule("pub");
                    let expectedResponse = { status: "ok" };
                    let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };

                    yield request(service._express).post("/events/message_incoming/subscribe")
                        .set("Accept", "application/json")
                        .send(payload)
                        .expect(200, expectedResponse);

                    payload = { service: "absentServiceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                    yield request(service._express).post("/events/message_incoming/unsubscribe")
                        .set("Accept", "application/json")
                        .send(payload)
                        .expect(200, expectedResponse);

                    expect(servicePub._subscribers["message_incoming"]).to.not.be.empty;
                }));
            });

            describe("when subscriber exists", function () {
                it("should return ok", function (done) {
                    let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                    let expectedResponse = { status: "ok" };

                    request(service._express).post("/events/message_incoming/unsubscribe")
                        .set("Accept", "application/json")
                        .send(payload)
                        .expect(200, expectedResponse, done);
                });

                it("should remove subscriber detail from _subscribers", function () {
                    let servicePub = service.getModule("pub");
                    expect(servicePub._subscribers["message_incoming"]).to.be.empty;
                });
            });
        });

        describe("when event doesn't exist", function () {
            it("should return error", function (done) {
                let payload = { service: "serviceName", uri: "http://serviceName", hook: "/handle_incoming_message" };
                let expectedResponse = { status: "error", error: "Event doesn't exist" };
                request(service._express).post("/events/absent_event/unsubscribe")
                    .set("Accept", "application/json")
                    .send(payload)
                    .expect(200, expectedResponse, done);
            });
        });
    });

    describe("event publishing", function () {
        it("should call specific hook", asyn(function* () {
            let testContainer = {};
            let messageManager = {};

            testContainer = merapi({
                basepath: __dirname,
                config: {
                    name: "test",
                    version: "1.0.0",
                    main: "mainCom",
                    service: {
                        "publish": {
                            "message_incoming": "triggerMessageIncoming"
                        },
                        "port": 5003
                    }
                }
            });

            testContainer.registerPlugin("service@yesboss", require("../index.js")(testContainer));
            testContainer.register("mainCom", class MainCom extends component {
                start() { }
                constructor(triggerMessageIncoming) {
                    super();
                    this.triggerMessageIncoming = triggerMessageIncoming;
                }

                handleIncomingMessage(payload) {
                    return this.triggerMessageIncoming(payload);
                }
            });

            testContainer.start();

            let count = 0;
            let app = express();

            app.use(bodyParser.urlencoded({ extended: true }));
            app.use(bodyParser.json());

            app.post("/hooks/handle_new_message", function (req, res) {
                count++;
                res.json({ status: "ok" });
            });

            app.listen(5554);

            yield sleep(50);

            let testService = yield testContainer.resolve("service");
            let payload = { service: "yb-core", uri: "localhost:5554", hook: "handle_new_message" };
            let expectedResponse = { status: "ok" };
            yield request(testService._express).post("/events/message_incoming/subscribe")
                .set("Accept", "application/json")
                .send(payload)
                .expect(200, expectedResponse);

            messageManager = yield testContainer.resolve("mainCom");
            yield messageManager.handleIncomingMessage({ key: "value" });

            expect(count).to.be.equal(1);
        }));
    });
});
