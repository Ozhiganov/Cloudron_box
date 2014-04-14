(function () {
'use strict';

if (!window.yellowtent) {
    window.yellowtent = {};
}

var yellowtent = window.yellowtent;
var server = 'https://localhost';

// handle the oauth flow
yellowtent.oauth = {};
yellowtent.endOAuth = endOAuth;

function startOAuth(event) {
    var button = event.target.parentElement;
    var clientId = button.getAttribute('data-clientid');
    var callback = button.getAttribute('data-callback');

    yellowtent.oauth = {};
    yellowtent.oauth.button = button;
    yellowtent.oauth.clientId = clientId;
    yellowtent.oauth.callback = callback;

    console.log('Staring OAuth for client ' + clientId + ' and callback ' + callback);

    var width = 400;
    var height = 600;
    var left = screen.width / 2.0 - width / 2.0;
    var top = screen.height / 2.0 - height / 2.0;
    var oauthURI = server + '/api/v1/oauth/dialog/authorize?response_type=code&client_id=' + clientId + '&redirect_uri=' + server + '/oauth2/oauth_callback.html';

    window.open(oauthURI, 'Yellowtent', 'width=400, height=600, left=' + left + ', top=' + top);
}

function endOAuth(result) {
    if (!yellowtent.oauth) {
        return;
    }

    if (!result.authCode) {
        console.error('OAuth result does not contain an authCode.');
        return;
    }

    yellowtent.oauth.button.style.display = 'none';
    window[yellowtent.oauth.callback].apply(null, [result.authCode]);
}

window.addEventListener('load', function () {
    console.log('Yellowtent init');

    var signIns = window.document.getElementsByClassName('yellowtent-signin');
    for (var i = 0; i < signIns.length; ++i) {
        var button = signIns[0];

        button.innerHTML = '<input class="btn btn-green btn-block" type="button" value="Sign in with Yellowtent"/>';
        button.onclick = startOAuth;
    }

}, false );

})();
