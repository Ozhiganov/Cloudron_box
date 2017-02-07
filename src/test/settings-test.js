/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

'use strict';

var async = require('async'),
    config = require('../config.js'),
    database = require('../database.js'),
    expect = require('expect.js'),
    settings = require('../settings.js');

function setup(done) {
    async.series([
        database.initialize,
        settings.initialize,
        function (callback) {
            // a cloudron must have a backup config to startup
            settings.setBackupConfig({ provider: 'caas', token: 'foo', key: 'key'}, function (error) {
                expect(error).to.be(null);
                callback();
            });
        }
    ], done);
}

function cleanup(done) {
    async.series([
        settings.uninitialize,
        database._clear
    ], done);
}

describe('Settings', function () {
    describe('values', function () {
        before(setup);
        after(cleanup);

        it('can get default timezone', function (done) {
            settings.getTimeZone(function (error, tz) {
                expect(error).to.be(null);
                expect(tz.length).to.not.be(0);
                done();
            });
        });

        it('can get default autoupdate_pattern', function (done) {
            settings.getAutoupdatePattern(function (error, pattern) {
                expect(error).to.be(null);
                expect(pattern).to.be('00 00 1,3,5,23 * * *');
                done();
            });
        });

        it ('can get default cloudron name', function (done) {
            settings.getCloudronName(function (error, name) {
                expect(error).to.be(null);
                expect(name).to.be('Cloudron');
                done();
            });
        });

        it('can get default cloudron avatar', function (done) {
            settings.getCloudronAvatar(function (error, gravatar) {
                expect(error).to.be(null);
                expect(gravatar).to.be.a(Buffer);
                done();
            });
        });

        it('can get default developer mode', function (done) {
            settings.getDeveloperMode(function (error, enabled) {
                expect(error).to.be(null);
                expect(enabled).to.equal(true);
                done();
            });
        });

        it('can set developer mode', function (done) {
            settings.setDeveloperMode(true, function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get developer mode', function (done) {
            settings.getDeveloperMode(function (error, enabled) {
                expect(error).to.be(null);
                expect(enabled).to.equal(true);
                done();
            });
        });

        it('can set dns config', function (done) {
            settings.setDnsConfig({ provider: 'route53', accessKeyId: 'accessKeyId', secretAccessKey: 'secretAccessKey' }, config.fqdn(), function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get dns config', function (done) {
            settings.getDnsConfig(function (error, dnsConfig) {
                expect(error).to.be(null);
                expect(dnsConfig.provider).to.be('route53');
                expect(dnsConfig.accessKeyId).to.be('accessKeyId');
                expect(dnsConfig.secretAccessKey).to.be('secretAccessKey');
                expect(dnsConfig.region).to.be('us-east-1');
                done();
            });
        });

        it('can set tls config', function (done) {
            settings.setTlsConfig({ provider: 'caas' }, function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get tls config', function (done) {
            settings.getTlsConfig(function (error, dnsConfig) {
                expect(error).to.be(null);
                expect(dnsConfig.provider).to.be('caas');
                done();
            });
        });

        it('can set backup config', function (done) {
            settings.setBackupConfig({ provider: 'caas', token: 'TOKEN' }, function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get backup config', function (done) {
            settings.getBackupConfig(function (error, backupConfig) {
                expect(error).to.be(null);
                expect(backupConfig.provider).to.be('caas');
                expect(backupConfig.token).to.be('TOKEN');
                done();
            });
        });

        it('can get default update config config', function (done) {
            settings.getUpdateConfig(function (error, updateConfig) {
                expect(error).to.be(null);
                expect(updateConfig.prerelease).to.be(false);
                done();
            });
        });

        it('can set update config', function (done) {
            settings.setUpdateConfig({ prerelease: true }, function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get update config', function (done) {
            settings.getUpdateConfig(function (error, updateConfig) {
                expect(error).to.be(null);
                expect(updateConfig.prerelease).to.be(true);
                done();
            });
        });

        it('can set mail config', function (done) {
            settings.setMailConfig({ enabled: true }, function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('can get mail config', function (done) {
            settings.getMailConfig(function (error, mailConfig) {
                expect(error).to.be(null);
                expect(mailConfig.enabled).to.be(true);
                done();
            });
        });

        it('can get all values', function (done) {
            settings.getAll(function (error, allSettings) {
                expect(error).to.be(null);
                expect(allSettings[settings.TIME_ZONE_KEY]).to.be.a('string');
                expect(allSettings[settings.AUTOUPDATE_PATTERN_KEY]).to.be.a('string');
                expect(allSettings[settings.CLOUDRON_NAME_KEY]).to.be.a('string');
                done();
            });
        });
    });
});
