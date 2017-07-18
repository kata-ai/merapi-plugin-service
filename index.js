"use strict";

module.exports = function () {
    return {
        dependencies: [],
        *onBeforeComponentsRegister(container) {
            container.register("service", require("./lib/service"));
            container.register("serviceApi", require("./lib/service_api"));
            container.register("servicePub", require("./lib/service_pub"));
            container.register("serviceSub", require("./lib/service_sub"));
            container.register("servicePubQueue", require("./lib/service_pub_queue"));
            container.register("serviceSubQueue", require("./lib/service_sub_queue"));
        },

        *onInit(container) {
            let service = yield container.resolve("service");
            let servicePub = yield container.resolve("servicePub");
            let serviceSub = yield container.resolve("serviceSub");
            let servicePubQueue = yield container.resolve("servicePubQueue");
            let serviceSubQueue = yield container.resolve("serviceSubQueue");
            let serviceApi = yield container.resolve("serviceApi");

            service.addModule("api", serviceApi);
            service.addModule("pub", servicePub);
            service.addModule("sub", serviceSub);
            service.addModule("pub-queue", servicePubQueue);
            service.addModule("sub-queue", serviceSubQueue);
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
