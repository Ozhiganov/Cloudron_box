CREATE TABLE IF NOT EXISTS users(
    id VARCHAR(128) NOT NULL UNIQUE,
    username VARCHAR(512) NOT NULL,
    email VARCHAR(512) NOT NULL,
    _password VARCHAR(512) NOT NULL,
    publicPem VARCHAR(2048) NOT NULL,
    _privatePemCipher VARCHAR(2048) NOT NULL,
    _salt VARCHAR(512) NOT NULL,
    createdAt VARCHAR(512) NOT NULL,
    modifiedAt VARCHAR(512) NOT NULL,
    admin INTEGER NOT NULL,
    PRIMARY KEY (id) );

CREATE TABLE IF NOT EXISTS tokens(
    accessToken VARCHAR(512) NOT NULL UNIQUE,
    userId VARCHAR(512) NOT NULL,
    clientId VARCHAR(512),
    expires VARCHAR(512) NOT NULL,
    PRIMARY KEY (accessToken) );

CREATE TABLE IF NOT EXISTS clients(
    id VARCHAR(512) NOT NULL UNIQUE,
    clientId VARCHAR(512) NOT NULL,
    clientSecret VARCHAR(512) NOT NULL,
    name VARCHAR(512) NOT NULL,
    redirectURI VARCHAR(512) NOT NULL,
    PRIMARY KEY (id) );

CREATE TABLE IF NOT EXISTS apps(
    id VARCHAR(512) NOT NULL UNIQUE,
    statusCode VARCHAR(512) NOT NULL,
    statusMessage VARCHAR(2048),
    containerId VARCHAR(128),
    manifestJson VARCHAR,
    httpPort INTEGER,
    location VARCHAR(512) NOT NULL UNIQUE,
    PRIMARY KEY (id) );

CREATE TABLE IF NOT EXISTS authcodes(
    authCode VARCHAR(512) NOT NULL UNIQUE,
    redirectURI VARCHAR(512) NOT NULL,
    userId VARCHAR(512) NOT NULL,
    clientId VARCHAR(512) NOT NULL,
    PRIMARY KEY (authCode) );

