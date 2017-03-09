'use strict';

angular.module('Application').controller('SettingsController', ['$scope', '$location', '$rootScope', 'Client', 'AppStore', function ($scope, $location, $rootScope, Client, AppStore) {
    Client.onReady(function () { if (!Client.getUserInfo().admin) $location.path('/'); });

    $scope.client = Client;
    $scope.user = Client.getUserInfo();
    $scope.config = Client.getConfig();
    $scope.backupConfig = {};
    $scope.dnsConfig = {};
    $scope.outboundPort25 = {};
    $scope.expectedDnsRecords = {};
    $scope.expectedDnsRecordsTypes = [
        { name: 'MX', value: 'mx' },
        { name: 'DKIM', value: 'dkim' },
        { name: 'SPF', value: 'spf' },
        { name: 'DMARC', value: 'dmarc' },
        { name: 'PTR', value: 'ptr' }
    ];
    $scope.appstoreConfig = {};

    $scope.mailConfig = null;

    $scope.lastBackup = null;
    $scope.backups = [];

    $scope.currency = null;

    $scope.availableRegions = [];
    $scope.currentRegionSlug = null;

    $scope.availablePlans = [];
    $scope.currentPlan = null;

    // List is from http://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region
    $scope.s3Regions = [
        { name: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
        { name: 'Asia Pacific (Seoul)', value: 'ap-northeast-2' },
        { name: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
        { name: 'Asia Pacific (Sydney)', value: 'ap-southeast-2' },
        { name: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
        { name: 'Canada (Central)', value: 'ca-central-1' },
        { name: 'EU (Frankfurt)', value: 'eu-central-1' },
        { name: 'EU (Ireland)', value: 'eu-west-1' },
        { name: 'EU (London)', value: 'eu-west-2' },
        { name: 'South America (São Paulo)', value: 'sa-east-1' },
        { name: 'US East (N. Virginia)', value: 'us-east-1' },
        { name: 'US East (Ohio)', value: 'us-east-2' },
        { name: 'US West (N. California)', value: 'us-west-1' },
        { name: 'US West (Oregon)', value: 'us-west-2' },
    ];

    $scope.planChange = {
        busy: false,
        error: {},
        password: '',
        requestedPlan: null,

        showChangePlan: function () {
            $('#planChangeModal').modal('show');
        },

        planChangeReset: function () {
            $scope.planChange.error.password = null;
            $scope.planChange.password = '';

            $scope.planChangeForm.$setPristine();
            $scope.planChangeForm.$setUntouched();
        },

        doChangePlan: function () {
            $scope.planChange.busy = true;

            var options = {
                size: $scope.planChange.requestedPlan.slug,
                name: $scope.planChange.requestedPlan.name,
                price: $scope.planChange.requestedPlan.price,
                region: $scope.currentRegionSlug
            };

            Client.migrate(options, $scope.planChange.password, function (error) {
                $scope.planChange.busy = false;

                if (error) {
                    if (error.statusCode === 403) {
                        $scope.planChange.error.password = true;
                        $scope.planChange.password = '';
                        $scope.planChangeForm.password.$setPristine();
                        $('#inputPlanChangePassword').focus();
                    } else {
                        console.error('Unable to change plan.', error);
                    }
                } else {
                    $scope.planChange.planChangeReset();

                    $('#planChangeModal').modal('hide');

                    window.location.href = '/update.html';
                }

                $scope.planChange.busy = false;
            });
        }
    };

    $scope.createBackup = {
        busy: false,
        percent: 100,
        message: '',
        errorMessage: '',

        doCreateBackup: function () {
            $scope.createBackup.busy = true;
            $scope.createBackup.percent = 0;
            $scope.createBackup.message = '';
            $scope.createBackup.errorMessage = '';

            Client.backup(function (error) {
                if (error) {
                    if (error.statusCode === 409 && error.message.indexOf('full_backup') !== -1) {
                        $scope.createBackup.errorMessage = 'Backup already in progress. Please retry later.';
                    } else if (error.statusCode === 409) {
                        $scope.createBackup.errorMessage = 'App task is currently in progress. Please retry later.';
                    } else {
                        console.error(error);
                        $scope.createBackup.errorMessage = error.message;
                    }

                    $scope.createBackup.busy = false;
                    $('#createBackupFailedModal').modal('show');

                    return;
                }

                function checkIfDone() {
                    Client.progress(function (error, data) {
                        if (error) return window.setTimeout(checkIfDone, 250);

                        // check if we are done
                        if (!data.backup || data.backup.percent >= 100) {
                            if (data.backup && data.backup.message) console.error('Backup message: ' + data.backup.message); // backup error message

                            $scope.createBackup.busy = false;
                            $scope.createBackup.message = '';

                            return fetchBackups();
                        }

                        $scope.createBackup.percent = data.backup.percent;
                        $scope.createBackup.message = data.backup.message;
                        window.setTimeout(checkIfDone, 250);
                    });
                }

                checkIfDone();
            });
        }
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
        }],

        getBlobFromImg: function (img, callback) {
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
        },

        doChangeAvatar: function () {
            $scope.avatarChange.error.avatar = null;
            $scope.avatarChange.busy = true;

            var img = document.getElementById('previewAvatar');
            $scope.avatarChange.avatar.file = $scope.avatarChange.getBlobFromImg(img, function (blob) {
                Client.changeCloudronAvatar(blob, function (error) {
                    if (error) {
                        console.error('Unable to change cloudron avatar.', error);
                    } else {
                        Client.resetAvatar();
                    }

                    $('#avatarChangeModal').modal('hide');
                    $scope.avatarChange.avatarChangeReset();
                });
            });
        },

        setPreviewAvatar: function (avatar) {
            $scope.avatarChange.avatar = avatar;
        },

        avatarChangeReset: function () {
            $scope.avatarChange.error.avatar = null;
            $scope.avatarChange.avatar = null;
            $scope.avatarChange.busy = false;
        },

        showChangeAvatar: function () {
            $scope.avatarChange.avatarChangeReset();
            $('#avatarChangeModal').modal('show');
        },

        showCustomAvatarSelector: function () {
            $('#avatarFileInput').click();
        }
    };

    $scope.email = {
        refreshBusy: false,

        toggle: function () {
            if ($scope.mailConfig.enabled) return $scope.email.disable();

            // show warning first
            $('#enableEmailModal').modal('show');
        },

        enable: function () {
            $('#enableEmailModal').modal('hide');

            Client.setMailConfig({ enabled: true }, function (error) {
                if (error) return console.error(error);

                $scope.mailConfig.enabled = true;
            });
        },

        disable: function () {
            Client.setMailConfig({ enabled: false }, function (error) {
                if (error) return console.error(error);

                $scope.mailConfig.enabled = false;
            });
        },

        refresh: function () {
            $scope.email.refreshBusy = true;

            showExpectedDnsRecords(function (error) {
                if (error) console.error(error);

                $scope.email.refreshBusy = false;
            });
        }
    };

    $scope.configureBackup = {
        busy: false,
        error: {},

        provider: 's3',
        bucket: '',
        prefix: '',
        accessKeyId: '',
        secretAccessKey: '',
        region: '',
        endpoint: '',

        show: function () {
            $scope.configureBackup.error = {};
            $scope.configureBackup.busy = false;

            $scope.configureBackup.bucket = $scope.backupConfig.bucket;
            $scope.configureBackup.prefix = $scope.backupConfig.prefix;
            $scope.configureBackup.region = $scope.backupConfig.region;
            $scope.configureBackup.accessKeyId = $scope.backupConfig.accessKeyId;
            $scope.configureBackup.secretAccessKey = $scope.backupConfig.secretAccessKey;
            $scope.configureBackup.endpoint = $scope.backupConfig.endpoint;
            $scope.configureBackup.key = $scope.backupConfig.key;

            $('#configureBackupModal').modal('show');
        },

        submit: function () {
            $scope.configureBackup.error = {};
            $scope.configureBackup.busy = true;

            var backupConfig = {
                provider: $scope.configureBackup.provider,
                bucket: $scope.configureBackup.bucket,
                prefix: $scope.configureBackup.prefix,
                accessKeyId: $scope.configureBackup.accessKeyId,
                secretAccessKey: $scope.configureBackup.secretAccessKey,
                key: $scope.configureBackup.key
            };

            if ($scope.configureBackup.region) backupConfig.region = $scope.configureBackup.region;
            if ($scope.configureBackup.endpoint) backupConfig.endpoint = $scope.configureBackup.endpoint;

            Client.setBackupConfig(backupConfig, function (error) {
                $scope.configureBackup.busy = false;

                if (error) {
                    if (error.statusCode === 402) {
                        $scope.configureBackup.error.generic = error.message;

                        if (error.message.indexOf('AWS Access Key Id') !== -1) {
                            $scope.configureBackup.error.accessKeyId = true;
                            $scope.configureBackup.accessKeyId = '';
                            $scope.configureBackupForm.accessKeyId.$setPristine();
                            $('#inputConfigureBackupAccessKeyId').focus();
                        } else if (error.message.indexOf('not match the signature') !== -1 ) {
                            $scope.configureBackup.error.secretAccessKey = true;
                            $scope.configureBackup.secretAccessKey = '';
                            $scope.configureBackupForm.secretAccessKey.$setPristine();
                            $('#inputConfigureBackupSecretAccessKey').focus();
                        } else if (error.message.toLowerCase() === 'access denied') {
                            $scope.configureBackup.error.bucket = true;
                            $scope.configureBackup.bucket = '';
                            $scope.configureBackupForm.bucket.$setPristine();
                            $('#inputConfigureBackupBucket').focus();
                        } else if (error.message.indexOf('ECONNREFUSED') !== -1) {
                            $scope.configureBackup.error.generic = 'Unknown region';
                            $scope.configureBackup.error.region = true;
                            $scope.configureBackupForm.region.$setPristine();
                            $('#inputConfigureBackupRegion').focus();
                        } else if (error.message.toLowerCase() === 'wrong region') {
                            $scope.configureBackup.error.generic = 'Wrong S3 Region';
                            $scope.configureBackup.error.region = true;
                            $scope.configureBackupForm.region.$setPristine();
                            $('#inputConfigureBackupRegion').focus();
                        } else {
                            $('#inputConfigureBackupBucket').focus();
                        }
                    } else {
                        console.error('Unable to change name.', error);
                    }

                    return;
                }

                // $scope.configureBackup.reset();
                $('#configureBackupModal').modal('hide');

                // TODO: be smarter and create new backup only when required
                $scope.createBackup.doCreateBackup();

                // now refresh the ui
                Client.refreshConfig();
                getBackupConfig();
            });
        }
    };

    $scope.autoUpdate = {
        busy: false,
        success: false,
        error: '',
        pattern: '',
        currentPattern: '',

        submit: function () {
            if ($scope.autoUpdate.pattern === $scope.autoUpdate.currentPattern) return;

            $scope.autoUpdate.error = '';
            $scope.autoUpdate.busy = true;
            $scope.autoUpdate.success = false;

            Client.setAutoupdatePattern($scope.autoUpdate.pattern, function (error) {
                if (error) $scope.autoUpdate.error = error.message;
                else $scope.autoUpdate.currentPattern = $scope.autoUpdate.pattern;

                $scope.autoUpdate.busy = false;
                $scope.autoUpdate.success = true;
            });
        }
    };

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

    function getMailConfig() {
        Client.getMailConfig(function (error, mailConfig) {
            if (error) return console.error(error);

            $scope.mailConfig = mailConfig;

            showExpectedDnsRecords();
        });
    }

    function getBackupConfig() {
        Client.getBackupConfig(function (error, backupConfig) {
            if (error) return console.error(error);

            $scope.backupConfig = backupConfig;

            // Check if a proper storage backend is configured
            if (backupConfig.provider === 'filesystem') {
                var actionScope = $scope.$new(true);
                actionScope.action = '/#/settings';

                Client.notify('Backup Configuration', 'Please setup an external backup storage to avoid data loss', false, 'info', actionScope);
            }
        });
    }

    function getDnsConfig() {
        Client.getDnsConfig(function (error, dnsConfig) {
            if (error) return console.error(error);

            $scope.dnsConfig = dnsConfig;
        });
    }

    function getAutoupdatePattern() {
        Client.getAutoupdatePattern(function (error, result) {
            if (error) return console.error(error);

            $scope.autoUpdate.currentPattern = result.pattern;
            $scope.autoUpdate.pattern = result.pattern;
        });
    }

    function showExpectedDnsRecords(callback) {
        callback = callback || function (error) { if (error) console.error(error); };

        Client.getEmailStatus(function (error, result) {
            if (error) return callback(error);

            $scope.expectedDnsRecords = result.dns;
            $scope.outboundPort25 = result.outboundPort25;

            callback(null);
        });
    }

    function getPlans() {
        AppStore.getSizes(function (error, result) {
            if (error) return console.error(error);

            var found = false;
            var SIZE_SLUGS = [ '512mb', '1gb', '2gb', '4gb', '8gb', '16gb', '32gb', '48gb', '64gb' ];
            result = result.filter(function (size) {
                // only show plans bigger than the current size
                if (found) return true;
                found = SIZE_SLUGS.indexOf(size.slug) > SIZE_SLUGS.indexOf($scope.config.plan.slug);
                return found;
            });
            angular.copy(result, $scope.availablePlans);

            // prepend the current plan
            $scope.availablePlans.unshift($scope.config.plan);

            $scope.planChange.requestedPlan = $scope.availablePlans[0]; // need the reference to preselect

            AppStore.getRegions(function (error, result) {
                if (error) return console.error(error);

                angular.copy(result, $scope.availableRegions);

                $scope.currentRegionSlug = $scope.config.region;
            });
        });
    }

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
                $scope.avatarChange.setPreviewAvatar(tmp);
            });
        };
        fr.readAsDataURL(event.target.files[0]);
    };

    $scope.cloudronNameChange = {
        busy: false,
        error: {},
        name: '',

        reset: function () {
            $scope.cloudronNameChange.busy = false;
            $scope.cloudronNameChange.error.name = null;
            $scope.cloudronNameChange.name = '';

            $scope.cloudronNameChangeForm.$setUntouched();
            $scope.cloudronNameChangeForm.$setPristine();
        },

        show: function () {
            $scope.cloudronNameChange.reset();
            $scope.cloudronNameChange.name = $scope.config.cloudronName;
            $('#cloudronNameChangeModal').modal('show');
        },

        submit: function () {
            $scope.cloudronNameChange.error.name = null;
            $scope.cloudronNameChange.busy = true;

            Client.changeCloudronName($scope.cloudronNameChange.name, function (error) {
                $scope.cloudronNameChange.busy = false;

                if (error) {
                    if (error.statusCode === 400) {
                        $scope.cloudronNameChange.error.name = 'Invalid name';
                        $scope.cloudronNameChange.name = '';
                        $('#inputCloudronName').focus();
                        $scope.cloudronNameChangeForm.password.$setPristine();
                    } else {
                        console.error('Unable to change name.', error);
                        return;
                    }
                }

                $scope.cloudronNameChange.reset();
                $('#cloudronNameChangeModal').modal('hide');

                Client.refreshConfig();
            });
        }
    };

    Client.onReady(function () {
        fetchBackups();
        getMailConfig();
        getBackupConfig();
        getDnsConfig();
        getAutoupdatePattern();

        if ($scope.config.provider === 'caas') {
            getPlans();

            $scope.currentPlan = $scope.config.plan;
            $scope.currency = $scope.config.currency === 'eur' ? '€' : '$';
        } else {
            Client.getAppstoreConfig(function (error, result) {
                if (error) return console.error(error);

                if (result.token) {
                    $scope.appstoreConfig = result;

                    AppStore.getProfile(result.token, function (error, result) {
                        if (error) return console.error(error);

                        $scope.appstoreConfig.profile = result;
                    });
                }
            });
        }
    });

    // setup all the dialog focus handling
    ['planChangeModal', 'appstoreLoginModal', 'cloudronNameChangeModal', 'configureBackupModal'].forEach(function (id) {
        $('#' + id).on('shown.bs.modal', function () {
            $(this).find("[autofocus]:first").focus();
        });
    });

    $('.modal-backdrop').remove();
}]);
