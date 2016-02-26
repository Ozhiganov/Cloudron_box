'use strict';

 // default admin installation location. keep in sync with ADMIN_LOCATION in setup/start.sh and BOX_ADMIN_LOCATION in appstore constants.js
exports = module.exports = {
    ADMIN_LOCATION: 'my',
    API_LOCATION: 'api', // this is unused but reserved for future use (#403)
    ADMIN_NAME: 'Settings',

    ADMIN_CLIENT_ID: 'webadmin', // oauth client id
    ADMIN_APPID: 'admin', // admin appid (settingsdb)

    DEFAULT_MEMORY_LIMIT: (256 * 1024 * 1024) // see also client.js
};

