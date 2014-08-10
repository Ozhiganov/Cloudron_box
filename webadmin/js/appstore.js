'use strict';

/* global angular:false */

angular.module('YellowTent').service('AppStore', function ($http, Client) {

    function AppStoreError(statusCode, message) {
        Error.call(this);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        if (typeof message == 'string') {
            this.message = message;
        } else {
            this.message = JSON.stringify(message);
        }
    }

    function AppStore() {
        this._appsCache = {};
    }

    AppStore.prototype.getApps = function (callback) {
        if (Client.getConfig().appServerUrl === null) return callback(new AppStoreError(500, 'Not yet initialized'));

        var that = this;

        $http.get(Client.getConfig().appServerUrl + '/api/v1/apps').success(function (data, status) {
            if (status !== 200) return callback(new AppStoreError(status, data));

            data.apps.forEach(function (app) {
                if (that._appsCache[app.id]) return;

                app.iconUrl = Client.getConfig().appServerUrl + '/api/v1/app/' + app.id + '/icon';
                that._appsCache[app.id] = app;
            });

            return callback(null, that._appsCache);
        }).error(function (data, status) {
            return callback(new AppStoreError(status, data));
        });
    };

    // TODO currently assumes that getApps was called at some point
    AppStore.prototype.getAppById = function (appId, callback) {
        if (this._appsCache !== null) {
            for (var i = 0; i < this._appsCache.length; i++) {
                if (this._appsCache[i].id === appId) return callback(null, this._appsCache[i]);
            }
        }
        return callback(new AppStoreError(404, 'Not found'));
    };

    AppStore.prototype.getManifest = function (appId, callback) {
        if (Client.getConfig().appServerUrl === null) return callback(new AppStoreError(500, 'Not yet initialized'));

        var manifestUrl = Client.getConfig().appServerUrl + '/api/v1/app/' + appId + '/manifest';
        console.log('Getting the manifest of ', appId, manifestUrl);
        $http.get(manifestUrl).success(function (data, status) {
            return callback(null, data);
        }).error(function (data, status) {
            return callback(new AppStoreError(status, data));
        });
    };
    return new AppStore();
});
