'use strict';

var assert = require('assert'),
    cloudron = require('./cloudron.js'),
    CronJob = require('cron').CronJob,
    debug = require('debug')('box:cron'),
    settings = require('./settings.js'),
    updater = require('./updater.js');

exports = module.exports = {
    initialize: initialize,
    uninitialize: uninitialize
};

var NOOP_CALLBACK = function (error) { console.error(error); };
var gAutoUpdaterJob = null,
    gUpdateCheckerJob = null,
    gHeartbeatJob = null,
    gBackupJob = null;

// cron format
// Seconds: 0-59
// Minutes: 0-59
// Hours: 0-23
// Day of Month: 1-31
// Months: 0-11
// Day of Week: 0-6

function initialize(callback) {
    assert(typeof callback === 'function');

    settings.events.on(settings.TIME_ZONE_KEY, recreateJobs);
    settings.events.on(settings.AUTOUPDATE_PATTERN_KEY, autoupdatePatternChanged);

    recreateJobs(callback);
}

function recreateJobs(unusedTimeZone, callback) {
    if (typeof unusedTimeZone === 'function') callback = unusedTimeZone;

    settings.getAll(function (error, allSettings) {
        if (gHeartbeatJob) gHeartbeatJob.stop();
        gHeartbeatJob = new CronJob({
            cronTime: '00 * * * * *', // every minute
            onTick: cloudron.sendHeartbeat,
            start: true,
            timeZone: allSettings[settings.TIME_ZONE_KEY]
        });

        if (gBackupJob) gBackupJob.stop();
        gBackupJob = new CronJob({
            cronTime: '00 00 0,4,8,12,16,20 * * *', // every 4 hours
            onTick: cloudron.backup,
            start: true,
            timeZone: allSettings[settings.TIME_ZONE_KEY]
        });

        if (gUpdateCheckerJob) gUpdateCheckerJob.stop();
        gUpdateCheckerJob = new CronJob({
            cronTime: '00 */1 * * * *', // every minute
            onTick: updater.checkUpdates,
            start: true,
            timeZone: allSettings[settings.TIME_ZONE_KEY]
        });

        autoupdatePatternChanged(allSettings[settings.AUTOUPDATE_PATTERN_KEY]);

        if (callback) callback();
    });
}

function autoupdatePatternChanged(pattern) {
    assert(typeof pattern === 'string');

    debug('Auto update pattern changed to %s', pattern);

    if (gAutoUpdaterJob) gAutoUpdaterJob.stop();

    if (pattern === 'never') return;

    gAutoUpdaterJob = new CronJob({
        cronTime: pattern,
        onTick: function() {
            debug('Checking if update available');
            if (updater.getUpdateInfo().box) updater.update(NOOP_CALLBACK);
        },
        start: true,
        timeZone: gUpdateCheckerJob.cronTime.timeZone // hack
    });
}

function uninitialize(callback) {
    assert(typeof callback === 'function');

    if (gAutoUpdaterJob) gAutoUpdaterJob.stop();
    gAutoUpdaterJob = null;

    gUpdateCheckerJob.stop();
    gUpdateCheckerJob = null;

    gHeartbeatJob.stop();
    gHeartbeatJob = null;

    gBackupJob.stop();
    gBackupJob = null;

    callback();
}

