'use strict';

/* global $:true */

var AppDetailsController = function ($scope, $http, $routeParams, $interval, Client) {
    $scope.app = {};
    $scope.initialized = false;

    $scope.updateAvailable = false;
    Client.onConfig(function () {
        if (!Client.getConfig().update) return;

        var appVersions = Client.getConfig().update.apps;
        if (!appVersions) return; // box doesn't have update information yet

        $scope.updateAvailable = appVersions.some(function (x) {
            return x.appId === $scope.app.appStoreId && x.version !== $scope.app.version;
        });
    });

    $scope.startApp = function () {
        Client.startApp($routeParams.appId, function (error) {
            if (error) console.error(error);
        });
    };

    $scope.stopApp = function () {
        Client.stopApp($routeParams.appId, function (error) {
            if (error) console.error(error);
        });
    };

    $scope.updateApp = function () {
        Client.updateApp($routeParams.appId, function (error) {
            if (error) console.error(error);
        });
    };

    $scope.deleteApp = function () {
        $('#deleteAppModal').modal('hide');

        Client.removeApp($routeParams.appId, function (error) {
            if (error) console.error(error);
            window.location.href = '#/';
        });
    };

    Client.refreshInstalledApps(function (error) {
        if (error) return console.error(error);

        Client.getApp($routeParams.appId, function (error, app) {
            if (error) {
                window.location.href = '#/';
                return;
            }

            $scope.app = app;
            $scope.initialized = true;
        });
    });

};
