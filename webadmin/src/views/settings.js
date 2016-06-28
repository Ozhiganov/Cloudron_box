'use strict';

angular.module('Application').controller('SettingsController', ['$scope', '$location', '$rootScope', 'Client', 'AppStore', function ($scope, $location, $rootScope, Client, AppStore) {
    Client.onReady(function () { if (!Client.getUserInfo().admin) $location.path('/'); });

    $scope.client = Client;
    $scope.user = Client.getUserInfo();
    $scope.config = Client.getConfig();
    $scope.dnsConfig = {};

    $scope.lastBackup = null;
    $scope.backups = [];

    $scope.currency = true ? '€' : '$';

    $scope.availableRegions = [];
    $scope.currentRegionSlug = null;

    $scope.availableSizes = [];
    $scope.requestedSize = null;
    $scope.currentSize = null;

    $scope.changePlan = {
        busy: false,
        error: {}
    };

    $scope.developerModeChange = {
        busy: false,
        error: {},
        password: ''
    };

    $scope.createBackup = {
        busy: false,
        percent: 100
    };

    $scope.avatarChange = {
        busy: false,
        error: {},
        avatar: null,
        availableAvatars: [{
            file: null,
            data: null,
            url: '/img/avatars/avatar_0.png',
        }, {
            file: null,
            data: null,
            url: '/img/avatars/rubber-duck.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/carrot.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/cup.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/football.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/owl.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/space-rocket.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/armchair.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/cap.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/pan.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/meat.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/umbrella.png'
        }, {
            file: null,
            data: null,
            url: '/img/avatars/jar.png'
        }]
    };

    $scope.setPreviewAvatar = function (avatar) {
        $scope.avatarChange.avatar = avatar;
    };

    $scope.showCustomAvatarSelector = function () {
        $('#avatarFileInput').click();
    };

    function avatarChangeReset() {
        $scope.avatarChange.error.avatar = null;
        $scope.avatarChange.avatar = null;
        $scope.avatarChange.busy = false;
    }

    function fetchBackups() {
        Client.getBackups(function (error, backups) {
            if (error) return console.error(error);

            $scope.backups = backups;

            if ($scope.backups.length > 0) {
                $scope.lastBackup = backups[0];
            } else {
                $scope.lastBackup = null;
            }
        });
    }

    function getSizes() {
        AppStore.getSizes(function (error, result) {
            if (error) return console.error(error);

            // result array is ordered by size. only select higher sizes
            var found = false;
            result = result.filter(function (size) {
                if (size.slug === $scope.config.size) {
                    $scope.currentSize = $scope.requestedSize = size;
                    found = true;
                    return true;
                } else {
                    return found;
                }
            });
            angular.copy(result, $scope.availableSizes);

            AppStore.getRegions(function (error, result) {
                if (error) return console.error(error);

                angular.copy(result, $scope.availableRegions);

                $scope.currentRegionSlug = $scope.config.region;
            });
        });
    }

    $scope.setRequestedPlan = function (plan) {
        $scope.requestedSize = plan;
    };

    $scope.showChangePlan = function () {
        $('#changePlanModal').modal('show');
    };

    $scope.doChangePlan = function () {
        $scope.changePlan.busy = true;

        Client.migrate($scope.requestedSize.slug, $scope.currentRegionSlug, $scope.plans.password, function (error) {
            $scope.changePlan.busy = false;

            if (error) {
                return console.error(error);
            }

            // we will get redirected at some point
            $('#changePlanModal').modal('hide');
            $scope.changePlan.busy = false;
        });
    };

    function developerModeChangeReset () {
        $scope.developerModeChange.error.password = null;
        $scope.developerModeChange.password = '';

        $scope.developerModeChangeForm.$setPristine();
        $scope.developerModeChangeForm.$setUntouched();
    }

    $scope.doChangeDeveloperMode = function () {
        $scope.developerModeChange.error.password = null;
        $scope.developerModeChange.busy = true;

        Client.changeDeveloperMode(!$scope.config.developerMode, $scope.developerModeChange.password, function (error) {
            if (error) {
                if (error.statusCode === 403) {
                    $scope.developerModeChange.error.password = true;
                    $scope.developerModeChange.password = '';
                    $scope.developerModeChangeForm.password.$setPristine();
                    $('#inputDeveloperModeChangePassword').focus();
                } else {
                    console.error('Unable to change developer mode.', error);
                }
            } else {
                developerModeChangeReset();

                $('#developerModeChangeModal').modal('hide');
            }

            $scope.developerModeChange.busy = false;
        });
    };

    function getBlobFromImg(img, callback) {
        var size = 256;

        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        var imageDimensionRatio = img.width / img.height;
        var canvasDimensionRatio = canvas.width / canvas.height;
        var renderableHeight, renderableWidth, xStart, yStart;

        if (imageDimensionRatio > canvasDimensionRatio) {
            renderableHeight = canvas.height;
            renderableWidth = img.width * (renderableHeight / img.height);
            xStart = (canvas.width - renderableWidth) / 2;
            yStart = 0;
        } else if (imageDimensionRatio < canvasDimensionRatio) {
            renderableWidth = canvas.width;
            renderableHeight = img.height * (renderableWidth / img.width);
            xStart = 0;
            yStart = (canvas.height - renderableHeight) / 2;
        } else {
            renderableHeight = canvas.height;
            renderableWidth = canvas.width;
            xStart = 0;
            yStart = 0;
        }

        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, xStart, yStart, renderableWidth, renderableHeight);

        canvas.toBlob(callback);
    }

    $scope.doChangeAvatar = function () {
        $scope.avatarChange.error.avatar = null;
        $scope.avatarChange.busy = true;

        var img = document.getElementById('previewAvatar');
        $scope.avatarChange.avatar.file = getBlobFromImg(img, function (blob) {
            Client.changeCloudronAvatar(blob, function (error) {
                if (error) {
                    console.error('Unable to change developer mode.', error);
                } else {
                    Client.resetAvatar();
                }

                $('#avatarChangeModal').modal('hide');
                avatarChangeReset();
            });
        });
    };

    $scope.doCreateBackup = function () {
        $('#createBackupModal').modal('hide');
        $scope.createBackup.busy = true;
        $scope.createBackup.percent = 100;

        Client.backup(function (error) {
            if (error) {
                console.error(error);
                $scope.createBackup.busy = false;
            }

            function checkIfDone() {
                Client.progress(function (error, data) {
                    if (error) return window.setTimeout(checkIfDone, 250);

                    // check if we are done
                    if (!data.backup || data.backup.percent >= 100) {
                        if (data.backup && data.backup.message) console.error('Backup message: ' + data.backup.message); // backup error message
                        fetchBackups();
                        $scope.createBackup.busy = false;
                        return;
                    }

                    $scope.createBackup.percent = data.backup.percent;
                    window.setTimeout(checkIfDone, 250);
                });
            }

            checkIfDone();
        });
    };

    $scope.showChangeDeveloperMode = function () {
        developerModeChangeReset();
        $('#developerModeChangeModal').modal('show');
    };

    $scope.showCreateBackup = function () {
        $('#createBackupModal').modal('show');
    };

    $scope.showChangeAvatar = function () {
        avatarChangeReset();
        $('#avatarChangeModal').modal('show');
    };

    $('#avatarFileInput').get(0).onchange = function (event) {
        var fr = new FileReader();
        fr.onload = function () {
            $scope.$apply(function () {
                var tmp = {
                    file: event.target.files[0],
                    data: fr.result,
                    url: null
                };

                $scope.avatarChange.availableAvatars.push(tmp);
                $scope.setPreviewAvatar(tmp);
            });
        };
        fr.readAsDataURL(event.target.files[0]);
    };

    Client.onReady(function () {
        fetchBackups();
        getSizes();
    });

    // setup all the dialog focus handling
    ['developerModeChangeModal'].forEach(function (id) {
        $('#' + id).on('shown.bs.modal', function () {
            $(this).find("[autofocus]:first").focus();
        });
    });
}]);
