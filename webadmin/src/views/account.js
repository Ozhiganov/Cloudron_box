'use strict';

angular.module('Application').controller('AccountController', ['$scope', '$location', 'Client', function ($scope, $location, Client) {
    $scope.user = Client.getUserInfo();
    $scope.config = Client.getConfig();

    $scope.activeClients = [];
    $scope.tokenInUse = null;

    $scope.passwordchange = {
        busy: false,
        error: {},
        password: '',
        newPassword: '',
        newPasswordRepeat: ''
    };

    $scope.emailchange = {
        busy: false,
        error: {},
        email: '',
        password: ''
    };

    function passwordChangeReset (form) {
        $scope.passwordchange.error.password = null;
        $scope.passwordchange.error.newPassword = null;
        $scope.passwordchange.error.newPasswordRepeat = null;
        $scope.passwordchange.password = '';
        $scope.passwordchange.newPassword = '';
        $scope.passwordchange.newPasswordRepeat = '';

        if (form) {
            form.$setPristine();
            form.$setUntouched();
        }
    }

    function emailChangeReset (form) {
        $scope.emailchange.error.email = null;
        $scope.emailchange.error.password = null;
        $scope.emailchange.email = '';
        $scope.emailchange.password = '';

        if (form) {
            form.$setPristine();
            form.$setUntouched();
        }
    }

    $scope.doChangePassword = function (form) {
        $scope.passwordchange.error.password = null;
        $scope.passwordchange.error.newPassword = null;
        $scope.passwordchange.error.newPasswordRepeat = null;
        $scope.passwordchange.busy = true;

        Client.changePassword($scope.passwordchange.password, $scope.passwordchange.newPassword, function (error) {
            if (error) {
                if (error.statusCode === 403) {
                    $scope.passwordchange.error.password = true;
                    $scope.passwordchange.password = '';
                    $('#inputPasswordChangePassword').focus();
                    $scope.passwordchange_form.password.$setPristine();
                } else if (error.statusCode === 400) {
                    $scope.passwordchange.error.newPassword = error.message;
                    $scope.passwordchange.newPassword = '';
                    $scope.passwordchange.newPasswordRepeat = '';
                    $scope.passwordchange_form.newPassword.$setPristine();
                    $scope.passwordchange_form.newPasswordRepeat.$setPristine();
                    $('#inputPasswordChangeNewPassword').focus();
                } else {
                    console.error('Unable to change password.', error);
                }
            } else {
                passwordChangeReset(form);

                $('#passwordChangeModal').modal('hide');
            }

            $scope.passwordchange.busy = false;
        });
    };

    $scope.doChangeEmail = function (form) {
        $scope.emailchange.error.email = null;
        $scope.emailchange.error.password = null;
        $scope.emailchange.busy = true;

        Client.changeEmail($scope.emailchange.email, $scope.emailchange.password, function (error) {
            if (error) {
                if (error.statusCode === 403) {
                    $scope.emailchange.error.password = true;
                    $scope.emailchange.password = '';
                    $('#inputEmailChangePassword').focus();
                } else {
                    console.error('Unable to change email.', error);
                }
            } else {
                emailChangeReset(form);

                // update user info in the background
                Client.refreshUserInfo();

                $('#emailChangeModal').modal('hide');
            }

            $scope.emailchange.busy = false;
        });
    };

    $scope.showChangePassword = function (form) {
        passwordChangeReset(form);

        $('#passwordChangeModal').modal('show');
    };

    $scope.showChangeEmail = function (form) {
        emailChangeReset(form);

        $('#emailChangeModal').modal('show');
    };

    $scope.removeAccessTokens = function (client) {
        client.busy = true;

        Client.delTokensByClientId(client.id, function (error) {
            if (error) console.error(error);

            client.busy = false;

            // update the list
            Client.getOAuthClients(function (error, activeClients) {
                if (error) return console.error(error);

                $scope.activeClients = activeClients;
            });
        });
    };

    Client.onReady(function () {
        $scope.tokenInUse = Client._token;

        Client.getOAuthClients(function (error, activeClients) {
            if (error) return console.error(error);

            $scope.activeClients = activeClients;
        });
    });

    // setup all the dialog focus handling
    ['passwordChangeModal', 'emailChangeModal'].forEach(function (id) {
        $('#' + id).on('shown.bs.modal', function () {
            $(this).find("[autofocus]:first").focus();
        });
    });
}]);
