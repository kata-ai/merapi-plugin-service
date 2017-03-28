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
                    "port": 5001
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

            start() { }
        });

        yield container.start();
        this.timeout(5000);

        service = yield container.resolve("service");
    }));

    after(asyn(function* () {
        yield container.stop();
    }));

    describe("API service", function () {
        it("should return API list", function () {
            let serviceApi = service.getModule("api");

            let expectedApi = {
                v1: ["getCustomer", "createCustomer"],
                v2: ["getCustomer", "createCustomer"]
            };

            let v1Api = serviceApi.getApiList("v1");
            let v2Api = serviceApi.getApiList("v2");

            expect(v1Api).to.deep.equal(expectedApi.v1);
            expect(v2Api).to.deep.equal(expectedApi.v2);
        });

        it("should return correct value", function (done) {
            let payload = { params: ["test"], metadata: { source: "source" } };
            let expectedResponse = { status: "ok", result: { param: ["test"] } };
            request(service._express).post("/api/v1/get_customer")
                .send(payload)
                .expect(200, expectedResponse, done);
        });
    });

});




