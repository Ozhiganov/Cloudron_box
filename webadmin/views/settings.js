'use strict';

var SettingsController = function ($scope, Client) {
    $scope.user = Client.getUserInfo();
    $scope.nakedDomainApp = null;

    $scope.setNakedDomain = function () {
        var appid = $scope.nakedDomainApp ? $scope.nakedDomainApp.id : null;

        Client.setNakedDomain(appid, function (error) {
            if (error) return console.error('Error setting naked domain', error);

            console.log('Updated naked domain');
        });
    };

    $scope.changePassword = function () {
        window.location.href = '#/userpassword';
    };

    Client.getApps(function (error, apps) {
        if (error) console.log('Error loading app list');
        $scope.apps = apps;

        console.dir($scope.apps);

        Client.getNakedDomain(function (error, appid) {
            if (error) return console.error(error);

            for (var i = 0; i < $scope.apps.length; i++) {
                if ($scope.apps[i].id === appid) {
                    $scope.nakedDomainApp = $scope.apps[i];
                    break;
                }
            }
        });
    });
};
