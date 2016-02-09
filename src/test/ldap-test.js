/* jslint node:true */
/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

'use strict';

var database = require('../database.js'),
    expect = require('expect.js'),
    EventEmitter = require('events').EventEmitter,
    async = require('async'),
    user = require('../user.js'),
    config = require('../config.js'),
    ldapServer = require('../ldap.js'),
    ldap = require('ldapjs');

var USER_0 = {
    username: 'foobar0',
    password: 'Foobar?1234',
    email: 'foo0@bar.com',
    displayName: 'Bob bobson'
};

var USER_1 = {
    username: 'foobar1',
    password: 'Foobar?12345',
    email: 'foo1@bar.com',
    displayName: 'Jesus'
};

function setup(done) {
    async.series([
        database.initialize.bind(null),
        database._clear.bind(null),
        ldapServer.start.bind(null),
        user.create.bind(null, USER_0.username, USER_0.password, USER_0.email, USER_0.displayName),
        user.create.bind(null, USER_1.username, USER_1.password, USER_1.email, USER_0.displayName, { invitor: USER_0 })
    ], done);
}

function cleanup(done) {
    database._clear(done);
}

describe('Ldap', function () {
    before(setup);
    after(cleanup);

    describe('bind', function () {
        it('fails for nonexisting user', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            client.bind('cn=doesnotexist,ou=users,dc=cloudron', 'password', function (error) {
                expect(error).to.be.a(ldap.NoSuchObjectError);
                done();
            });
        });

        it('fails with wrong password', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            client.bind('cn=' + USER_0.username + ',ou=users,dc=cloudron', 'wrongpassword', function (error) {
                expect(error).to.be.a(ldap.InvalidCredentialsError);
                done();
            });
        });

        it('succeeds', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            client.bind('cn=' + USER_0.username + ',ou=users,dc=cloudron', USER_0.password, function (error) {
                expect(error).to.be(null);
                done();
            });
        });
    });

    describe('search users', function () {
        it ('fails for non existing tree', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: '(&(l=Seattle)(email=*@foo.com))'
            };

            client.search('o=example', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                result.on('error', function (error) {
                    expect(error).to.be.a(ldap.NoSuchObjectError);
                    done();
                });
                result.on('end', function (result) {
                    done(new Error('Should not succeed. Status ' + result.status));
                });
            });
        });

        it ('succeeds with basic filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: 'objectcategory=person'
            };

            client.search('ou=users,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(2);
                    expect(entries[0].username).to.equal(USER_0.username);
                    expect(entries[1].username).to.equal(USER_1.username);
                    done();
                });
            });
        });

        it ('succeeds with username wildcard filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: '&(objectcategory=person)(username=foobar*)'
            };

            client.search('ou=users,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(2);
                    expect(entries[0].username).to.equal(USER_0.username);
                    expect(entries[1].username).to.equal(USER_1.username);
                    done();
                });
            });
        });

        it ('succeeds with username filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: '&(objectcategory=person)(username=' + USER_0.username + ')'
            };

            client.search('ou=users,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(1);
                    expect(entries[0].username).to.equal(USER_0.username);
                    expect(entries[0].memberof.length).to.equal(2);
                    done();
                });
            });
        });
    });

    describe('search groups', function () {
        it ('succeeds with basic filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: 'objectclass=group'
            };

            client.search('ou=groups,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(2);
                    expect(entries[0].cn).to.equal('users');
                    expect(entries[0].memberuid.length).to.equal(2);
                    expect(entries[0].memberuid[0]).to.equal(USER_0.username);
                    expect(entries[0].memberuid[1]).to.equal(USER_1.username);
                    expect(entries[1].cn).to.equal('admins');
                    // if only one entry, the array becomes a string :-/
                    expect(entries[1].memberuid).to.equal(USER_0.username);
                    done();
                });
            });
        });

        it ('succeeds with cn wildcard filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: '&(objectclass=group)(cn=*)'
            };

            client.search('ou=groups,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(2);
                    expect(entries[0].cn).to.equal('users');
                    expect(entries[0].memberuid.length).to.equal(2);
                    expect(entries[0].memberuid[0]).to.equal(USER_0.username);
                    expect(entries[0].memberuid[1]).to.equal(USER_1.username);
                    expect(entries[1].cn).to.equal('admins');
                    // if only one entry, the array becomes a string :-/
                    expect(entries[1].memberuid).to.equal(USER_0.username);
                    done();
                });
            });
        });

        it('succeeds with memberuid filter', function (done) {
            var client = ldap.createClient({ url: 'ldap://127.0.0.1:' + config.get('ldapPort') });

            var opts = {
                filter: '&(objectclass=group)(memberuid=' + USER_1.username + ')'
            };

            client.search('ou=groups,dc=cloudron', opts, function (error, result) {
                expect(error).to.be(null);
                expect(result).to.be.an(EventEmitter);

                var entries = [];

                result.on('searchEntry', function (entry) { entries.push(entry.object); });
                result.on('error', done);
                result.on('end', function (result) {
                    expect(result.status).to.equal(0);
                    expect(entries.length).to.equal(1);
                    expect(entries[0].cn).to.equal('users');
                    expect(entries[0].memberuid.length).to.equal(2);
                    done();
                });
            });
        });
    });
});
