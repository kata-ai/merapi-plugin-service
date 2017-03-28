"use strict";

module.exports = function () {
    return {
        dependencies: [],
        *onBeforeComponentsRegister(container) {
            container.register("service", require("./lib/service"));
            container.register("serviceApi", require("./lib/service_api"));
            container.register("servicePub", require("./lib/service_pub"));
            container.register("serviceSub", require("./lib/service_sub"));
        },

        *onInit(container) {
            let service = yield container.resolve("service");
            let servicePub = yield container.resolve("servicePub");
            let serviceSub = yield container.resolve("serviceSub");
            let serviceApi = yield container.resolve("serviceApi");

            service.addModule("api", serviceApi);
            service.addModule("pub", servicePub);
            service.addModule("sub", serviceSub);
        },

        *onStart(container) {
            let service = yield container.resolve("service");
            yield service.start();
        },

        *onStop(container) {
            let service = yield container.resolve("service");
            yield service.stop();
        }
    };
};
