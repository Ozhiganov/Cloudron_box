'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var Server = require('../../../src/server.js'),
    request = require('superagent'),
    expect = require('expect.js'),
    userdb = require('../../userdb.js'),
    crypto = require('crypto'),
    rimraf = require('rimraf'),
    path = require('path'),
    os = require('os');

var BASE_DIR = path.resolve(os.tmpdir(), 'volume-test-' + crypto.randomBytes(4).readUInt32LE(0));
var CONFIG = {
    port: 3333,
    dataRoot: path.resolve(BASE_DIR, 'data'),
    configRoot: path.resolve(BASE_DIR, 'config'),
    mountRoot: path.resolve(BASE_DIR, 'mount'),
    appDataRoot: path.resolve(BASE_DIR, 'appdata'),
    silent: true,
    appServerUrl: 'invalid_url',
    nginxAppConfigDir: '/tmp'
};
var SERVER_URL = 'http://localhost:' + CONFIG.port;

var ADMIN = 'admin', PASSWORD = 'admin', EMAIL ='silly@me.com';
var USERNAME_1 = 'userTheFirst', PASSWORD_1 = 'chocolatecookie', EMAIL_1 = 'tao@zen.mac', IS_ADMIN_1 = true;
var USERNAME_2 = 'userTheSecond', PASSWORD_2 = 'userpassword', EMAIL_2 = 'user@foo.bar', IS_ADMIN_2 = false;
var USERNAME_3 = 'userTheThird', PASSWORD_3 = 'userpassword333', EMAIL_3 = 'user3@foo.bar', IS_ADMIN_2 = false;

var server;
function setup(done) {
    server = new Server(CONFIG);
    server.start(function (error) {
        expect(!error).to.be.ok();
        userdb.clear(done);
    });
}

// remove all temporary folders
function cleanup(done) {
    server.stop(function (error) {
        expect(error).to.be(null);
        rimraf(BASE_DIR, done);
    });
}

describe('Server User API', function () {
    this.timeout(5000);

    var token = null;
    var token_2 = null;

    before(setup);
    after(cleanup);

    it('device is in first time mode', function (done) {
        request.get(SERVER_URL + '/api/v1/firsttime')
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body.activated).to.not.be.ok();
            done(err);
        });
    });

    it('create admin fails due to missing parameters', function (done) {
        request.post(SERVER_URL + '/api/v1/createadmin')
               .send({ username: ADMIN })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('create admin fails because only POST is allowed', function (done) {
        request.get(SERVER_URL + '/api/v1/createadmin')
               .end(function (err, res) {
            expect(res.statusCode).to.equal(404);
            done(err);
        });
    });

    it('create admin', function (done) {
        request.post(SERVER_URL + '/api/v1/createadmin')
               .send({ username: ADMIN, password: PASSWORD, email: EMAIL })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(201);
            done(err);
        });
    });

    it('device left first time mode', function (done) {
        request.get(SERVER_URL + '/api/v1/firsttime')
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body.activated).to.be.ok();
            done(err);
        });
    });

    it('create token fails due to wrong credentials', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
               .auth(ADMIN, 'wrong' + PASSWORD)
               .end(function (err, res) {
            expect(err).to.not.be.ok();
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('create token fails due to non basic auth header', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
               .set('Authorization', ADMIN + ':wrong' + PASSWORD)
               .end(function (err, res) {
            expect(err).to.not.be.ok();
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('create token fails due to broken basic auth header', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
               .set('Authorization', 'Basic ' + ADMIN + ':wrong' + PASSWORD)
               .end(function (err, res) {
            expect(err).to.not.be.ok();
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('create token fails due to wrong arguments', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
               .auth(ADMIN, '')
               .end(function (err, res) {
            expect(err).to.not.be.ok();
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('create token', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
               .auth(ADMIN, PASSWORD)
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body.token).to.be.a('string');
            expect(res.body.expires).to.be.a('string');
            expect(res.body.username).to.not.be.ok();
            expect(res.body.email).to.not.be.ok();
            expect(res.body.userInfo).to.be.ok();
            expect(res.body.userInfo.username).to.be.ok();
            expect(res.body.userInfo.admin).to.be.ok();

            // save token for further calls
            token = res.body.token;

            done(err);
        });
    });

    it('can get userInfo with token', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .query({ auth_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body.username).to.equal(ADMIN);
            expect(res.body.email).to.equal(EMAIL);
            expect(res.body.admin).to.be.ok();
            done(err);
        });
    });

    it('cannot get userInfo only with basic auth', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .auth(ADMIN, PASSWORD)
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('cannot get userInfo with invalid token (token length)', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .query({ auth_token: 'x' + token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('cannot get userInfo with invalid token (wrong token)', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .query({ auth_token: token.toUpperCase() })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('can get userInfo with token in auth header', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .set('Authorization', 'Token ' + token)
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            expect(res.body.username).to.equal(ADMIN);
            expect(res.body.email).to.equal(EMAIL);
            expect(res.body.admin).to.be.ok();
            done(err);
        });
    });

    it('cannot get userInfo with invalid token in auth header', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .set('Authorization', 'Token ' + 'x' + token)
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('cannot get userInfo with invalid token (wrong token)', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .set('Authorization', 'Token ' + 'x' + token.toUpperCase())
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('create second admin should succeed with first admin credentials', function (done) {
        request.post(SERVER_URL + '/api/v1/createadmin')
               .query({ auth_token: token })
               .send({ username: USERNAME_1, password: PASSWORD_1, email: EMAIL_1 })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(201);
            done(err);
        });
    });

    it('create user missing arguments should fail', function (done) {
        request.post(SERVER_URL + '/api/v1/user/create')
               .query({ auth_token: token })
               .send({ username: USERNAME_2, email: EMAIL })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(400);

            request.post(SERVER_URL + '/api/v1/user/create')
                   .query({ auth_token: token })
                   .send({ username: USERNAME_2, password: PASSWORD })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done(err);
            });
        });
    });

    it('create second and third user', function (done) {
        request.post(SERVER_URL + '/api/v1/user/create')
               .query({ auth_token: token })
               .send({ username: USERNAME_2, password: PASSWORD_2, email: EMAIL_2 })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(201);

            request.post(SERVER_URL + '/api/v1/user/create')
                   .query({ auth_token: token })
                   .send({ username: USERNAME_3, password: PASSWORD_3, email: EMAIL_3 })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(201);
                done(err);
            });
        });
    });

    it('create user with same username should fail', function (done) {
        request.post(SERVER_URL + '/api/v1/user/create')
               .query({ auth_token: token })
               .send({ username: USERNAME_2, password: PASSWORD, email: EMAIL })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(409);
            done(err);
        });
    });

    it('second user userInfo', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
        .auth(USERNAME_2, PASSWORD_2)
        .end(function (error, result) {
            expect(error).to.be(null);
            expect(result.body.token).to.be.a('string');

            // safe token for further calls
            token_2 = result.body.token;

            request.get(SERVER_URL + '/api/v1/user/info')
            .query({ access_token: token_2 })
            .end(function (error, result) {
                expect(error).to.be(null);
                expect(result.statusCode).to.equal(200);
                expect(result.body.username).to.equal(USERNAME_2);
                expect(result.body.email).to.equal(EMAIL_2);
                expect(result.body.admin).to.not.be.ok();

                done();
            });
        });
    });

    it('list users', function (done) {
        request.get(SERVER_URL + '/api/v1/user/list')
        .query({ access_token: token_2 })
        .end(function (error, res) {
            expect(error).to.be(null);
            expect(res.statusCode).to.equal(200);
            expect(res.body.users).to.be.an('array');
            expect(res.body.users.length).to.equal(4);
            expect(res.body.users[0]).to.be.an('object');

            done();
        });
    });

    it('remove admin user by normal user should fail', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token_2 })
        .send({ username: ADMIN, password: PASSWORD_2 })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(403);
            done(err);
        });
    });

    it('user removes himself is not allowed', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token_2 })
        .send({ username: USERNAME_2, password: PASSWORD_2 })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(403);
            done(err);
        });
    });

    it('admin cannot remove normal user without giving a password', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token })
        .send({ username: USERNAME_3 })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('admin cannot remove normal user with giving wrong password', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token })
        .send({ username: USERNAME_3, password: PASSWORD_3 })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('admin removes normal user', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token })
        .send({ username: USERNAME_3, password: PASSWORD })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            done(err);
        });
    });

    it('cannot logout with invalid token', function (done) {
        request.get(SERVER_URL + '/api/v1/logout')
               .query({ auth_token: token.toUpperCase() })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('can logout', function (done) {
        request.get(SERVER_URL + '/api/v1/logout')
               .query({ auth_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            done(err);
        });
    });

    it('cannot get userInfo with old token (previous logout)', function (done) {
        request.get(SERVER_URL + '/api/v1/user/info')
               .query({ auth_token: token })
               .end(function (err, res) {
            expect(res.statusCode).to.equal(401);
            done(err);
        });
    });

    it('can login again', function (done) {
        request.post(SERVER_URL + '/api/v1/token')
        .auth(ADMIN, PASSWORD)
        .end(function (error, res) {
            expect(error).to.be(null);
            expect(res.statusCode).to.equal(200);
            expect(res.body.token).to.be.a('string');
            token = res.body.token;

            expect(res.body.expires).to.be.a('string');
            expect(res.body.username).to.not.be.ok();
            expect(res.body.email).to.not.be.ok();

            done();
        });
    });

    it('admin removes himself should not be allowed', function (done) {
        request.post(SERVER_URL + '/api/v1/user/remove')
        .query({ access_token: token })
        .send({ username: ADMIN, password: PASSWORD })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(403);
            done(err);
        });
    });

    it('change password fails due to missing current password', function (done) {
        request.post(SERVER_URL + '/api/v1/user/password')
        .query({ access_token: token })
        .send({ newPassword: 'some wrong password' })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('change password fails due to missing new password', function (done) {
        request.post(SERVER_URL + '/api/v1/user/password')
        .query({ access_token: token })
        .send({ password: PASSWORD })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(400);
            done(err);
        });
    });

    it('change password fails due to wrong password', function (done) {
        request.post(SERVER_URL + '/api/v1/user/password')
        .query({ access_token: token })
        .send({ password: 'some wrong password', newPassword: 'new_password' })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(403);
            done(err);
        });
    });

      it('change password succeeds', function (done) {
        request.post(SERVER_URL + '/api/v1/user/password')
        .query({ access_token: token })
        .send({ password: PASSWORD, newPassword: 'new_password' })
        .end(function (err, res) {
            expect(res.statusCode).to.equal(200);
            done(err);
        });
    });
});
