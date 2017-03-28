"use strict";

const chai = require("chai");
const expect = chai.expect;
const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const sleep = require("then-sleep");

const merapi = require("merapi");
const component = require("merapi/component");
const asyn = require("merapi/async");

/* eslint-env mocha */

describe("Merapi Plugin Service: Subscriber", function () {
    let container = {};
    let service = {};
    let count = 0;
    let body = {};

    before(asyn(function* () {
        let app = express();

        app.use(bodyParser.urlencoded({ extended: true }));
        app.use(bodyParser.json());

        app.post("/events/incoming_message/subscribe", function (req) {
            count++;
            body = req.body;
        });

        app.post("/events/outgoing_message/subscribe", function (req) {
            count++;
            body = req.body;
        });

        app.listen(5555);

        container = merapi({
            basepath: __dirname,
            config: {
                name: "test",
                version: "1.0.0",
                main: "mainCom",
                service: {
                    "subscribe": {
                        "yb-core": {
                            "incoming_message": "mainCom.handleIncomingMessage"
                        }
                    },
                    "registry": {
                        "yb-core": "http://localhost:5555"
                    },
                    "notify_interval": 10,
                    "port": 5004
                }
            }
        });

        container.registerPlugin("service", require("../index.js")(container));
        container.register("mainCom", class MainCom extends component {
            start() { }
            handleIncomingMessage() { }
        });

        yield container.start();
        this.timeout(5000);

        service = yield container.resolve("service");
    }));

    after(asyn(function* () {
        yield container.stop();
    }));

    describe("subscription update", function () {
        it("should send subscription request every notify_interval", asyn(function* () {
            yield sleep(50);

            let expectedBody = {
                "hook": "yb-core.incoming_message",
                "service": "test",
                "uri": "test:5004"
            };

            expect(count).to.be.at.least(1);
            expect(body).to.be.deep.equal(expectedBody);
        }));
    });

    describe("getHookList", function () {
        it("should return hook list", function () {
            let serviceSub = service.getModule("sub");
            let expectedSub = ["yb-core.incoming_message"];
            expect(serviceSub.getHookList()).to.deep.equal(expectedSub);
        });
    });

    describe("subscription hook", function () {
        it("should return correct value", asyn(function* () {
            let payload = { key: "value" };
            let expectedResponse = { status: "ok" };

            yield request(service._express)
                .post("/hooks/yb-core.incoming_message")
                .send(payload)
                .expect(200, expectedResponse);
        }));
    });

    describe("registry", function () {
        it("should be resolved", function () {
            let serviceSub = service.getModule("sub");
            expect(serviceSub.resolve("yb-core")).to.equal("http://localhost:5555");
            expect(serviceSub.resolve("docker")).to.equal("http://docker:5000");
        });
    });


});
