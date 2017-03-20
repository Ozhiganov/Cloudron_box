/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

'use strict';

var appdb = require('../../appdb.js'),
    async = require('async'),
    child_process = require('child_process'),
    cloudron = require('../../cloudron.js'),
    config = require('../../config.js'),
    constants = require('../../constants.js'),
    database = require('../../database.js'),
    expect = require('expect.js'),
    path = require('path'),
    paths = require('../../paths.js'),
    superagent = require('superagent'),
    server = require('../../server.js'),
    settings = require('../../settings.js'),
    fs = require('fs'),
    nock = require('nock');

var SERVER_URL = 'http://localhost:' + config.get('port');

var USERNAME = 'superadmin', PASSWORD = 'Foobar?1337', EMAIL ='silly@me.com';
var token = null;

var server;
function setup(done) {
    config.set('fqdn', 'foobar.com');

    async.series([
        server.start.bind(server),

        database._clear,

        function createAdmin(callback) {
            var scope1 = nock(config.apiServerOrigin()).get('/api/v1/boxes/' + config.fqdn() + '/setup/verify?setupToken=somesetuptoken').reply(200, {});
            var scope2 = nock(config.apiServerOrigin()).post('/api/v1/boxes/' + config.fqdn() + '/setup/done?setupToken=somesetuptoken').reply(201, {});

            superagent.post(SERVER_URL + '/api/v1/cloudron/activate')
                   .query({ setupToken: 'somesetuptoken' })
                   .send({ username: USERNAME, password: PASSWORD, email: EMAIL })
                   .end(function (error, result) {
                expect(result).to.be.ok();
                expect(result.statusCode).to.eql(201);
                expect(scope1.isDone()).to.be.ok();
                expect(scope2.isDone()).to.be.ok();

                // stash token for further use
                token = result.body.token;

                callback();
            });
        },

        function addApp(callback) {
            var manifest = { version: '0.0.1', manifestVersion: 1, dockerImage: 'foo', healthCheckPath: '/', httpPort: 3, title: 'ok' };
            appdb.add('appid', 'appStoreId', manifest, 'location', [ ] /* portBindings */, { }, callback);
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

    describe('autoupdate_pattern', function () {
        it('can get auto update pattern (default)', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/autoupdate_pattern')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.pattern).to.be.ok();
                done();
            });
        });

        it('cannot set autoupdate_pattern without pattern', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/autoupdate_pattern')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('can set autoupdate_pattern', function (done) {
            var eventPattern = null;
            settings.events.on(settings.AUTOUPDATE_PATTERN_KEY, function (pattern) {
                eventPattern = pattern;
            });

            superagent.post(SERVER_URL + '/api/v1/settings/autoupdate_pattern')
                   .query({ access_token: token })
                   .send({ pattern: '00 30 11 * * 1-5' })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(eventPattern === '00 30 11 * * 1-5').to.be.ok();
                done();
            });
        });

        it('can set autoupdate_pattern to never', function (done) {
            var eventPattern = null;
            settings.events.on(settings.AUTOUPDATE_PATTERN_KEY, function (pattern) {
                eventPattern = pattern;
            });

            superagent.post(SERVER_URL + '/api/v1/settings/autoupdate_pattern')
                   .query({ access_token: token })
                   .send({ pattern: constants.AUTOUPDATE_PATTERN_NEVER })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(eventPattern).to.eql(constants.AUTOUPDATE_PATTERN_NEVER);
                done();
            });
        });

        it('cannot set invalid autoupdate_pattern', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/autoupdate_pattern')
                   .query({ access_token: token })
                   .send({ pattern: '1 3 x 5 6' })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });
    });

    describe('cloudron_name', function () {
        var name = 'foobar';

        it('get default succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/cloudron_name')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.name).to.be.ok();
                done();
            });
        });

        it('cannot set without name', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/cloudron_name')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set empty name', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/cloudron_name')
                   .query({ access_token: token })
                   .send({ name: '' })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set succeeds', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/cloudron_name')
                   .query({ access_token: token })
                   .send({ name: name })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(202);
                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/cloudron_name')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.name).to.eql(name);
                done();
            });
        });
    });

    describe('cloudron_avatar', function () {
        it('get default succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/cloudron_avatar')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.be.a(Buffer);
                done();
            });
        });

        it('cannot set without data', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/cloudron_avatar')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set succeeds', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/cloudron_avatar')
                   .query({ access_token: token })
                   .attach('avatar', paths.CLOUDRON_DEFAULT_AVATAR_FILE)
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(202);
                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/cloudron_avatar')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.toString()).to.eql(fs.readFileSync(paths.CLOUDRON_DEFAULT_AVATAR_FILE, 'utf-8'));
                done(err);
            });
        });
    });

    describe('dns_config', function () {
        it('get dns_config fails', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/dns_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({ provider: 'manual' });
                done();
            });
        });

        it('cannot set without data', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/dns_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set succeeds', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/dns_config')
                   .query({ access_token: token })
                   .send({ provider: 'route53', accessKeyId: 'accessKey', secretAccessKey: 'secretAccessKey' })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/dns_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({ provider: 'route53', accessKeyId: 'accessKey', secretAccessKey: 'secretAccessKey', region: 'us-east-1', endpoint: null });
                done();
            });
        });
    });

    describe('mail_config', function () {
        it('get mail_config succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/mail_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({ enabled: false });
                done();
            });
        });

        it('cannot set without enabled field', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/mail_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set succeeds', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/mail_config')
                   .query({ access_token: token })
                   .send({ enabled: true })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/mail_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({ enabled: true });
                done();
            });
        });
    });

    describe('Certificates API', function () {
        var validCert0, validKey0, // foobar.com
            validCert1, validKey1; // *.foobar.com

        before(function () {
            child_process.execSync('openssl req -subj "/CN=foobar.com/O=My Company Name LTD./C=US" -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout /tmp/server.key -out /tmp/server.crt');
            validKey0 = fs.readFileSync('/tmp/server.key', 'utf8');
            validCert0 = fs.readFileSync('/tmp/server.crt', 'utf8');

            child_process.execSync('openssl req -subj "/CN=*.foobar.com/O=My Company Name LTD./C=US" -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout /tmp/server.key -out /tmp/server.crt');
            validKey1 = fs.readFileSync('/tmp/server.key', 'utf8');
            validCert1 = fs.readFileSync('/tmp/server.crt', 'utf8');
        });

        it('cannot set certificate without token', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(401);
                done();
            });
        });

        it('cannot set certificate without certificate', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ key: validKey1 })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set certificate without key', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ cert: validCert1 })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set certificate with cert not being a string', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ cert: 1234, key: validKey1 })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set certificate with key not being a string', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ cert: validCert1, key: true })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('cannot set non wildcard certificate', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ cert: validCert0, key: validKey0 })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(400);
                done();
            });
        });

        it('can set certificate', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/certificate')
                   .query({ access_token: token })
                   .send({ cert: validCert1, key: validKey1 })
                   .end(function (error, result) {
                expect(result.statusCode).to.equal(202);
                done();
            });
        });

        it('did set the certificate', function (done) {
            var cert = fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.cert'), 'utf-8');
            expect(cert).to.eql(validCert1);

            var key = fs.readFileSync(path.join(paths.NGINX_CERT_DIR, 'host.key'), 'utf-8');
            expect(key).to.eql(validKey1);

            done();
        });
    });

    describe('time_zone', function () {
        it('succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/time_zone')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.timeZone).to.be('America/Los_Angeles');
                done();
            });
        });
    });

    describe('appstore_config', function () {
        it('get appstore_config fails', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({});
                done();
            });
        });

        it('cannot set without data', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set fails with wrong appstore token', function (done) {
            var scope = nock(config.apiServerOrigin()).post('/api/v1/users/nebulon/cloudrons?accessToken=sometoken').reply(401);

            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .send({ userId: 'nebulon', token: 'sometoken' })
                   .end(function (err, res) {
                expect(scope.isDone()).to.be.ok();
                expect(res.statusCode).to.equal(406);
                expect(res.body.message).to.equal('invalid appstore token');

                done();
            });
        });

        it('set succeeds for unknown cloudron', function (done) {
            var scope = nock(config.apiServerOrigin()).post('/api/v1/users/nebulon/cloudrons?accessToken=sometoken').reply(201, { cloudron: { id: 'cloudron0' }});

            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .send({ userId: 'nebulon', token: 'sometoken' })
                   .end(function (err, res) {
                expect(scope.isDone()).to.be.ok();
                expect(res.statusCode).to.equal(202);
                expect(res.body).to.eql({ userId: 'nebulon', token: 'sometoken', cloudronId: 'cloudron0' });

                done();
            });
        });

        it('set fails with wrong appstore user', function (done) {
            var scope = nock(config.apiServerOrigin()).get('/api/v1/users/nebulon/cloudrons/cloudron0?accessToken=sometoken').reply(403);

            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .send({ userId: 'nebulon', token: 'sometoken' })
                   .end(function (err, res) {
                expect(scope.isDone()).to.be.ok();
                expect(res.statusCode).to.equal(406);
                expect(res.body.message).to.equal('wrong user');

                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body).to.eql({ userId: 'nebulon', token: 'sometoken', cloudronId: 'cloudron0' });
                done();
            });
        });

        it('set succeeds with cloudronId', function (done) {
            var scope = nock(config.apiServerOrigin()).get('/api/v1/users/nebulon/cloudrons/cloudron0?accessToken=someothertoken').reply(200, { cloudron: { id: 'cloudron0' }});

            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .send({ userId: 'nebulon', token: 'someothertoken' })
                   .end(function (err, res) {
                expect(scope.isDone()).to.be.ok();
                expect(res.statusCode).to.equal(202);
                expect(res.body).to.eql({ userId: 'nebulon', token: 'someothertoken', cloudronId: 'cloudron0' });

                done();
            });
        });

        it('set succeeds with cloudronId but unkown one (reregister)', function (done) {
            var scope0 = nock(config.apiServerOrigin()).get('/api/v1/users/nebulon/cloudrons/cloudron0?accessToken=someothertoken').reply(404);
            var scope1 = nock(config.apiServerOrigin()).post('/api/v1/users/nebulon/cloudrons?accessToken=someothertoken').reply(201, { cloudron: { id: 'cloudron1' }});

            superagent.post(SERVER_URL + '/api/v1/settings/appstore_config')
                   .query({ access_token: token })
                   .send({ userId: 'nebulon', token: 'someothertoken' })
                   .end(function (err, res) {
                expect(scope0.isDone()).to.be.ok();
                expect(scope1.isDone()).to.be.ok();
                expect(res.statusCode).to.equal(202);
                expect(res.body).to.eql({ userId: 'nebulon', token: 'someothertoken', cloudronId: 'cloudron1' });

                done();
            });
        });
    });

    describe('email DNS records', function () {
        var resolve = null;
        var dnsAnswerQueue = [];
        var dkimDomain, spfDomain, mxDomain, dmarcDomain;

        before(function (done) {
            var dns = require('native-dns');

            // replace dns resolveTxt()
            resolve = dns.resolve;
            dns.resolve = function (hostname, type, callback) {
                expect(hostname).to.be.a('string');
                expect(callback).to.be.a('function');

                if (!dnsAnswerQueue[hostname] || !(type in dnsAnswerQueue[hostname])) return callback(new Error('no mock answer'));

                callback(null, dnsAnswerQueue[hostname][type]);
            };

            dkimDomain = 'cloudron._domainkey.' + config.fqdn();
            spfDomain = config.fqdn();
            mxDomain = config.fqdn();
            dmarcDomain = '_dmarc.' + config.fqdn();

            done();
        });

        after(function (done) {
            var dns = require('native-dns');

            dns.resolve = resolve;

            done();
        });

        it('does not fail when dns errors', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                done();
            });
        });

        function clearDnsAnswerQueue() {
            dnsAnswerQueue = { };
            dnsAnswerQueue[dkimDomain] =  { };
            dnsAnswerQueue[spfDomain] =  { };
            dnsAnswerQueue[mxDomain] =  { };
            dnsAnswerQueue[dmarcDomain] =  { };
        }

        it('succeeds with dns errors', function (done) {
            clearDnsAnswerQueue();

            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);

                expect(res.body.dkim).to.be.an('object');
                expect(res.body.dkim.domain).to.eql(dkimDomain);
                expect(res.body.dkim.type).to.eql('TXT');
                expect(res.body.dkim.value).to.eql(null);
                expect(res.body.dkim.expected).to.eql('v=DKIM1; t=s; p=' + cloudron.readDkimPublicKeySync());
                expect(res.body.dkim.status).to.eql(false);

                expect(res.body.spf).to.be.an('object');
                expect(res.body.spf.domain).to.eql(spfDomain);
                expect(res.body.spf.type).to.eql('TXT');
                expect(res.body.spf.value).to.eql(null);
                expect(res.body.spf.expected).to.eql('v=spf1 a:' + config.adminFqdn() + ' ~all');
                expect(res.body.spf.status).to.eql(false);

                expect(res.body.dmarc).to.be.an('object');
                expect(res.body.dmarc.type).to.eql('TXT');
                expect(res.body.dmarc.value).to.eql(null);
                expect(res.body.dmarc.expected).to.eql('v=DMARC1; p=reject; pct=100');
                expect(res.body.dmarc.status).to.eql(false);

                expect(res.body.mx).to.be.an('object');
                expect(res.body.mx.type).to.eql('MX');
                expect(res.body.mx.value).to.eql(null);
                expect(res.body.mx.expected).to.eql('10 ' + config.mailFqdn());
                expect(res.body.mx.status).to.eql(false);

                expect(res.body.ptr).to.be.an('object');
                expect(res.body.ptr.type).to.eql('PTR');
                // expect(res.body.ptr.value).to.eql(null); this will be anything random
                expect(res.body.ptr.expected).to.eql(config.mailFqdn());
                expect(res.body.ptr.status).to.eql(false);

                done();
            });
        });

        it('succeeds with "undefined" spf, dkim, dmarc, mx, ptr records', function (done) {
            clearDnsAnswerQueue();

            dnsAnswerQueue[dkimDomain].TXT = null;
            dnsAnswerQueue[spfDomain].TXT = null;
            dnsAnswerQueue[mxDomain].MX = null;
            dnsAnswerQueue[dmarcDomain].TXT = null;

            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);

                expect(res.body.spf).to.be.an('object');
                expect(res.body.spf.expected).to.eql('v=spf1 a:' + config.adminFqdn() + ' ~all');
                expect(res.body.spf.status).to.eql(false);
                expect(res.body.spf.value).to.eql(null);

                expect(res.body.dkim).to.be.an('object');
                expect(res.body.dkim.expected).to.eql('v=DKIM1; t=s; p=' + cloudron.readDkimPublicKeySync());
                expect(res.body.dkim.status).to.eql(false);
                expect(res.body.dkim.value).to.eql(null);

                expect(res.body.dmarc).to.be.an('object');
                expect(res.body.dmarc.expected).to.eql('v=DMARC1; p=reject; pct=100');
                expect(res.body.dmarc.status).to.eql(false);
                expect(res.body.dmarc.value).to.eql(null);

                expect(res.body.mx).to.be.an('object');
                expect(res.body.mx.status).to.eql(false);
                expect(res.body.mx.expected).to.eql('10 ' + config.mailFqdn());
                expect(res.body.mx.value).to.eql(null);

                expect(res.body.ptr).to.be.an('object');
                expect(res.body.ptr.expected).to.eql(config.mailFqdn());
                expect(res.body.ptr.status).to.eql(false);
                // expect(res.body.ptr.value).to.eql(null); this will be anything random

                done();
            });
        });

        it('succeeds with all different spf, dkim, dmarc, mx, ptr records', function (done) {
            clearDnsAnswerQueue();

            dnsAnswerQueue[mxDomain].MX = [ { priority: '20', exchange: config.mailFqdn() }, { priority: '30', exchange: config.mailFqdn() } ];
            dnsAnswerQueue[dmarcDomain].TXT = [['v=DMARC2; p=reject; pct=100']];
            dnsAnswerQueue[dkimDomain].TXT = [['v=DKIM2; t=s; p=' + cloudron.readDkimPublicKeySync()]];
            dnsAnswerQueue[spfDomain].TXT = [['v=spf1 a:random.com ~all']];

            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);

                expect(res.body.spf).to.be.an('object');
                expect(res.body.spf.expected).to.eql('v=spf1 a:' + config.adminFqdn() + ' a:random.com ~all');
                expect(res.body.spf.status).to.eql(false);
                expect(res.body.spf.value).to.eql('v=spf1 a:random.com ~all');

                expect(res.body.dkim).to.be.an('object');
                expect(res.body.dkim.expected).to.eql('v=DKIM1; t=s; p=' + cloudron.readDkimPublicKeySync());
                expect(res.body.dkim.status).to.eql(false);
                expect(res.body.dkim.value).to.eql('v=DKIM2; t=s; p=' + cloudron.readDkimPublicKeySync());

                expect(res.body.dmarc).to.be.an('object');
                expect(res.body.dmarc.expected).to.eql('v=DMARC1; p=reject; pct=100');
                expect(res.body.dmarc.status).to.eql(false);
                expect(res.body.dmarc.value).to.eql('v=DMARC2; p=reject; pct=100');

                expect(res.body.mx).to.be.an('object');
                expect(res.body.mx.status).to.eql(false);
                expect(res.body.mx.expected).to.eql('10 ' + config.mailFqdn());
                expect(res.body.mx.value).to.eql('20 ' + config.mailFqdn() + ' 30 ' + config.mailFqdn());

                expect(res.body.ptr).to.be.an('object');
                expect(res.body.ptr.expected).to.eql(config.mailFqdn());
                expect(res.body.ptr.status).to.eql(false);
                // expect(res.body.ptr.value).to.eql(null); this will be anything random

                done();
            });
        });

        it('succeeds with existing embedded spf', function (done) {
            clearDnsAnswerQueue();

            dnsAnswerQueue[spfDomain].TXT = [['v=spf1 a:example.com a:' + config.mailFqdn() + ' ~all']];

            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);

                expect(res.body.spf).to.be.an('object');
                expect(res.body.spf.domain).to.eql(spfDomain);
                expect(res.body.spf.type).to.eql('TXT');
                expect(res.body.spf.value).to.eql('v=spf1 a:example.com a:' + config.mailFqdn() + ' ~all');
                expect(res.body.spf.expected).to.eql('v=spf1 a:example.com a:' + config.mailFqdn() + ' ~all');
                expect(res.body.spf.status).to.eql(true);

                done();
            });
        });

        it('succeeds with all correct records', function (done) {
            clearDnsAnswerQueue();

            dnsAnswerQueue[mxDomain].MX = [ { priority: '10', exchange: config.mailFqdn() } ];
            dnsAnswerQueue[dmarcDomain].TXT = [['v=DMARC1; p=reject; pct=100']];
            dnsAnswerQueue[dkimDomain].TXT = [['v=DKIM1;', 't=s;', 'p=' + cloudron.readDkimPublicKeySync()]];
            dnsAnswerQueue[spfDomain].TXT = [['v=spf1', ' a:' + config.adminFqdn(), ' ~all']];

            superagent.get(SERVER_URL + '/api/v1/settings/email_dns_records')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);

                expect(res.body.dkim).to.be.an('object');
                expect(res.body.dkim.domain).to.eql(dkimDomain);
                expect(res.body.dkim.type).to.eql('TXT');
                expect(res.body.dkim.value).to.eql('v=DKIM1; t=s; p=' + cloudron.readDkimPublicKeySync());
                expect(res.body.dkim.expected).to.eql('v=DKIM1; t=s; p=' + cloudron.readDkimPublicKeySync());
                expect(res.body.dkim.status).to.eql(true);

                expect(res.body.spf).to.be.an('object');
                expect(res.body.spf.domain).to.eql(spfDomain);
                expect(res.body.spf.type).to.eql('TXT');
                expect(res.body.spf.value).to.eql('v=spf1 a:' + config.adminFqdn() + ' ~all');
                expect(res.body.spf.expected).to.eql('v=spf1 a:' + config.adminFqdn() + ' ~all');
                expect(res.body.spf.status).to.eql(true);

                expect(res.body.dmarc).to.be.an('object');
                expect(res.body.dmarc.expected).to.eql('v=DMARC1; p=reject; pct=100');
                expect(res.body.dmarc.status).to.eql(true);
                expect(res.body.dmarc.value).to.eql('v=DMARC1; p=reject; pct=100');

                expect(res.body.mx).to.be.an('object');
                expect(res.body.mx.status).to.eql(true);
                expect(res.body.mx.expected).to.eql('10 ' + config.mailFqdn());
                expect(res.body.mx.value).to.eql('10 ' + config.mailFqdn());

                done();
            });
        });
    });

    describe('open_registration', function () {
        it('get open_registration succeeds without being set', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/open_registration')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.enabled).to.equal(false);
                done();
            });
        });

        it('cannot set without data', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/open_registration')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(400);
                done();
            });
        });

        it('set succeeds', function (done) {
            superagent.post(SERVER_URL + '/api/v1/settings/open_registration')
                   .query({ access_token: token })
                   .send({ enabled: true })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                done();
            });
        });

        it('get succeeds', function (done) {
            superagent.get(SERVER_URL + '/api/v1/settings/open_registration')
                   .query({ access_token: token })
                   .end(function (err, res) {
                expect(res.statusCode).to.equal(200);
                expect(res.body.enabled).to.equal(true);
                done();
            });
        });
    });
});
