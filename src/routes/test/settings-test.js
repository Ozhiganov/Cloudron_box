/* jslint node:true */
/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

'use strict';

var appdb = require('../../appdb.js'),
    apptask = require('../../apptask.js'),
    async = require('async'),
    config = require('../../../config.js'),
    constants = require('../../../constants.js'),
    database = require('../../database.js'),
    expect = require('expect.js'),
    fs = require('fs'),
    paths = require('../../paths.js'),
    request = require('superagent'),
    server = require('../../server.js'),
    sinon = require('sinon'),
    nock = require('nock'),
    userdb = require('../../userdb.js');

var SERVER_URL = 'http://localhost:' + config.get('port');

var USERNAME = 'admin', PASSWORD = 'password', EMAIL ='silly@me.com';
var token = null;

var server;
function setup(done) {
    async.series([
        server.start.bind(server),

        userdb._clear,

        function createAdmin(callback) {
            var scope1 = nock(config.apiServerOrigin()).get('/api/v1/boxes/' + config.fqdn() + '/setup/verify?setupToken=somesetuptoken').reply(200, {});
            var scope2 = nock(config.apiServerOrigin()).post('/api/v1/boxes/' + config.fqdn() + '/setup/done?setupToken=somesetuptoken').reply(201, {});

            request.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .query({ setupToken: 'somesetuptoken' })
                   .send({ username: USERNAME, password: PASSWORD, email: EMAIL })
                   .end(function (error, result) {
                expect(error).to.not.be.ok();
                expect(result).to.be.ok();
                expect(result.statusCode).to.eql(201);
                expect(scope1.isDone());
                expect(scope2.isDone());
                callback();
            });
        },

        function createToken(callback) {
            request.get(SERVER_URL + '/api/v1/users/' + USERNAME + '/login')
                   .auth(USERNAME, PASSWORD)
                   .end(function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.ok();

                token = result.body.token;
                callback();
            });
        },

        function addApp(callback) {
            appdb.add('appid', 'appStoreId', '0.0.1', 'location', [ ] /* portBindings */, '' /* accessRestriction */, callback);
        }
    ], done);
}

function cleanup(done) {
    database._clear(function (error) {
        expect(!error).to.be.ok();

        server.stop(done);
    });
}

describe('Settings API', function () {
    this.timeout(10000);

    before(setup);
    after(cleanup);

    it('can get naked domain (not set)', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: constants.ADMIN_APPID });
            done(err);
        });
    });

    it('cannot set naked domain without appid', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done();
        });
    });

    it('cannot set naked domain to invalid app', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: 'random' })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(404);
            done();
        });
    });

    it('cannot set naked domain to empty appid', function (done) {
        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: '' })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(404);
            done();
        });
    });

    it('can set naked domain to valid app', function (done) {
        var reloadNginxStub = sinon.stub(apptask, '_reloadNginx').callsArgWith(0, null);

        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: 'appid' })
               .end(function (err, res) {
            reloadNginxStub.restore();
            expect(res.statusCode).to.equal(204);
            expect(fs.readFileSync(paths.NGINX_CONFIG_DIR + '/naked_domain.conf').length > 10).to.be.ok();
            expect(reloadNginxStub.callCount).to.be(1);
            done();
        });
    });

    it('can get naked domain (set)', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: 'appid' });
            done(err);
        });
    });

    it('can set naked domain to admin', function (done) {
        var reloadNginxStub = sinon.stub(apptask, '_reloadNginx').callsArgWith(0, null);

        request.post(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .send({ appid: constants.ADMIN_APPID })
               .end(function (err, res) {
            reloadNginxStub.restore();
            expect(res.statusCode).to.equal(204);
            expect(fs.readFileSync(paths.NGINX_CONFIG_DIR + '/naked_domain.conf').length !== 0).to.be.ok();
            expect(reloadNginxStub.callCount).to.be(1);
            done();
        });
    });

    it('must have admin as naked domain', function (done) {
        request.get(SERVER_URL + '/api/v1/settings/naked_domain')
               .query({ access_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body).to.eql({ appid: constants.ADMIN_APPID });
            done(err);
        });
    });
});

