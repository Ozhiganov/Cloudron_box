'use strict';

angular.module('Application').controller('MainController', ['$scope', '$route', '$interval', 'Client', function ($scope, $route, $interval, Client) {
    $scope.initialized = false;
    $scope.user = Client.getUserInfo();
    $scope.installedApps = Client.getInstalledApps();
    $scope.config = {};

    $scope.update = {
        busy: false,
        error: {},
        password: ''
    };

    $scope.isActive = function (url) {
        if (!$route.current) return false;
        return $route.current.$$route.originalPath.indexOf(url) === 0;
    };

    $scope.logout = function (event) {
        event.stopPropagation();
        $scope.initialized = false;
        Client.logout();
    };

    $scope.login = function () {
        var callbackURL = window.location.protocol + '//' + window.location.host + '/login_callback.html';
        var scope = 'root,profile,apps,roleAdmin';

        // generate a state id to protect agains csrf
        var state = Math.floor((1 + Math.random()) * 0x1000000000000).toString(16).substring(1);
        window.localStorage.oauth2State = state;

        window.location.href = Client.apiOrigin + '/api/v1/oauth/dialog/authorize?response_type=token&client_id=' + Client._clientId + '&redirect_uri=' + callbackURL + '&scope=' + scope + '&state=' + state;
    };

    $scope.setup = function () {
        window.location.href = '/error.html?errorCode=1';
    };

    $scope.error = function (error) {
        console.error(error);
        window.location.href = '/error.html';
    };

    $scope.showUpdateModal = function (form) {
        $scope.update.error.password = null;
        $scope.update.password = '';

        form.$setPristine();
        form.$setUntouched();

        $('#updateModal').modal('show');
    };

    $scope.doUpdate = function () {
        $scope.update.error.password = null;

        $scope.update.busy = true;
        Client.update($scope.update.password, function (error) {
            if (error) {
                if (error.statusCode === 403) {
                    $scope.update.error.password = 'Incorrect password';
                    $scope.update.password = '';
                    $('#inputUpdatePassword').focus();
                } else {
                    console.error('Unable to update.', error);
                }
                $scope.update.busy = false;
                return;
            }

            window.location.href = '/update.html';
        });
    };

    Client.isServerFirstTime(function (error, isFirstTime) {
        if (error) return $scope.error(error);
        if (isFirstTime) return $scope.setup();

        // we use the config request as an indicator if the token is still valid
        // TODO we should probably attach such a handler for each request, as the token can get invalid
        // at any time!
        if (localStorage.token) {
            Client.refreshConfig(function (error) {
                if (error && error.statusCode === 401) return $scope.login();
                if (error) return $scope.error(error);

                Client.refreshUserInfo(function (error, result) {
                    if (error) return $scope.error(error);

                    Client.refreshInstalledApps(function (error) {
                        if (error) return $scope.error(error);

                        // kick off installed apps and config polling
                        var refreshAppsTimer = $interval(Client.refreshInstalledApps.bind(Client), 2000);
                        var refreshConfigTimer = $interval(Client.refreshConfig.bind(Client), 5000);
                        var refreshUserInfoTimer = $interval(Client.refreshUserInfo.bind(Client), 5000);

                        $scope.$on('$destroy', function () {
                            $interval.cancel(refreshAppsTimer);
                            $interval.cancel(refreshConfigTimer);
                            $interval.cancel(refreshUserInfoTimer);
                        });

                        // now mark the Client to be ready
                        Client.setReady();

                        $scope.config = Client.getConfig();

                        $scope.initialized = true;
                    });
                });
            });
        } else {
            $scope.login();
        }
    });

    // wait till the view has loaded until showing a modal dialog
    Client.onConfig(function (config) {
        // check if we are actually updating
        if (config.progress.update && config.progress.update.percent !== -1) {
            window.location.href = '/update.html';
        }

        if (config.cloudronName) {
            document.title = config.cloudronName;
        }
    });

    // setup all the dialog focus handling
    ['updateModal'].forEach(function (id) {
        $('#' + id).on('shown.bs.modal', function () {
            $(this).find("[autofocus]:first").focus();
        });
    });
}]);
