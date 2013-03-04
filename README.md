# (Unofficial) WaniKani JS API Wrapper

(c) 2012 Daniel Bowring

First writing/test version. Need to add comments, testing, documentation, ...

## Features

- Automatic Data caching
    - Queries are cached (and stored in localStorage where available) to
        avoid duplicate queries
        - Takes query arguments into account
        - By default, data expires after 2 hours.
    - Several Helper function
        - TODO: list helpers/wrappers

## Basic Usage

    // Get a user
    user = wanikani.getUser(API_KEY);

    // Get User Information
    user.withUserInfo().then(function(user) {
        console.log(user.info.username());
    });
