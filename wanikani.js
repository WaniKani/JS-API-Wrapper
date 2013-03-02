/*
    JS WaniKani API Wrapper
    (c) 2012 Daniel Bowring

    TODO: Comment everything, test it all.


    Basic usage:

        // Get a user
        user = wanikani.getUser(API_KEY);

        // Get User Information
        user.withUserInfo().do(function(user) {
            console.log(user.information.username);
        });

    Known Issues:
        - current argument caching wont work with critical-items and
            recent-unlocks

*/

var wanikani = (function(window, document) {
    var users = {};
    var api_base = 'http://www.wanikani.com/api/v1.1/user';
    var JSONP = {};
    var JSONP_NEXTID = 0;


    var storage = (function() {
        /*
        This allows for queried data to be cached (since it hardly changed);
        */
        var support = 'localStorage' in window && window.localStorage !== null;
        support = support && 'JSON' in window && window.JSON !== null;
        // var max_lifespan = 60 * 60 * 24 * 1000;  // 24 Hours
        var max_lifespan = 60 * 60 * 2 * 1000;  // 2 Hours
        var setValue, getValue;

        var cache = support ? window.localStorage : ({});

        var isStale = function(container) {
            return new Date() > new Date(container.created + max_lifespan);
        };
        var stamp = function(data) {
            return {
                created: new Date().getTime(),
                data: data
            };
        };
        var hasKey = function(key) {
            return key in cache;
        };
        var deleteKey = function(key) {
            delete cache[key];
        };
        var deletePrefix = function(prefix) {
            for (var k in cache) {
                if (k.slice(0, prefix.length) == prefix) {
                    value = getValue(k);
                    if (value !== null && value !== undefined) {
                        deleteKey(k);
                    }
                }
            }
        };

        var setMaxAge = function(milliseconds) {
            max_lifespan = milliseconds;
        };

        var cleanup = function() {
            for (var k in cache) {
                if (isStale(k)) {
                    deleteKey(k);
                }
            }
        };

        var getPrefix = function(prefix) {
            var result = {}, value;
            for (var k in cache) {
                if (k.slice(0, prefix.length) == prefix) {
                    value = getValue(k);
                    if (value !== null && value !== undefined) {
                        result[k] = value;
                    }
                }
            }
            return result;
        };

        if (support) {
            setValue = function(key, value) {
                cache[key] = JSON.stringify(stamp(value));
            };
            getValue = function(key) {
                if (key in cache) {
                    var stamped = JSON.parse(cache[key]);
                    if (isStale(stamped)) {
                        deleteKey(key);
                        return undefined;
                    }
                    return stamped.data;
                }
                return undefined;
            };
        } else {
            setValue = function(key, value) {
                cache[key] = stamp(value);
            };
            getValue = function(key) {
                if (key in cache) {
                    if (isStale(cache[key])) {
                        delete cache[key];
                        return undefined;
                    }
                    return cache[key].data;
                }
                return undefined;
            };
        }

        return {
            hasSupport: support,
            getValue: getValue,
            setValue: setValue,
            deleteKey: deleteKey,
            hasKey: hasKey,
            setMaxAge: setMaxAge,
            cleanup: cleanup,
            getPrefix: getPrefix,
            deletePrefix: deletePrefix
        };
    })();

    var globalize = function(fn, context) {
        var id = 'wanikani_' + (++JSONP_NEXTID);
        var wrapper = function() {
            delete JSONP[id];
            fn.apply(context, arguments);
        };
        JSONP[id] = wrapper;
        return 'wanikani.JSONP.' + id;
    };

    var getURI = function() {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(api_base);
        return args.join('/');
    };

    var jsonp_query = function(url, success, error, context) {
        var script = document.createElement('script');
        script.charset = 'utf-8';
        script.type = 'text/javascript';

        if (context) {
            script.onerror = function() {
                error.apply(context, arguments);
            };
        } else {
            script.onerror = error;
        }

        if (url.indexOf('?') > 0) {
            url += '&';
        } else {
            url += '?';
        }
        url += 'callback=' + globalize(success);
        script.src = url;

        (document.getElementsByTagName('body') ||
            document.getElementsByTagName('head'))[0].appendChild(script);
    };

    var SimplePromise = function() {
        this.completed = true;
        this.succeded = null;

        this._success = [];
        this._error = [];
        this._complete = [];
    };
    SimplePromise.prototype.onComplete = function(fn, context) {
        if (this.completed) {
            fn.apply(context, this._complete);
        } else {
            this._complete.push([fn, context]);
        }
        return this;
    };
    SimplePromise.prototype.onSuccess = function(fn, context) {
        if (this.succeded === true) {
            fn.apply(context, this._success);
        } else {
            this._success.push([fn, context]);
        }
        return this;
    };
    SimplePromise.prototype.use = SimplePromise.prototype.onSuccess;
    SimplePromise.prototype.onError = function(fn, context) {
        if (this.succeded === false) {
            fn.apply(context, this._error);
        } else {
            this._error.push([fn, context]);
        }
        return this;
    };
    SimplePromise.prototype.doSuccess = function() {
        this.succeded = true;
        for (var i=0; i<this._success.length; ++i) {
            this._success[i][0].apply(this._success[i][1], arguments);
        }
        this._success = arguments;
        this.doComplete();
    };
    SimplePromise.prototype.doError = function() {
        this.succeded = false;
        for (var i=0; i<this._error.length; ++i) {
            this._error[i][0].apply(this._error[i][1], arguments);
        }
        this._error = arguments;
        this.doComplete();
    };
    SimplePromise.prototype.doComplete = function() {
        this.completed = true;
        for (var i=0; i<this._complete.length; ++i) {
            this._complete[i][0].apply(this._complete[i][1], arguments);
        }
        this._complete = arguments;
    };

    var copy_prototype = function(source, destination) {
        for (var k in source.prototype) {
            destination.prototype[k] = source.prototype[k];
        }
    };

    var UserInformation = function(data) {
        /*
            "username": STRING,
            "gravatar": STRING(32),
            "level": INT,
            "title": STRING { "unseen", "guppie", "apprentice", "guru", "master", "enlightened", "burned"},

    "unseen": "rgb(40, 40, 40)",
    "apprentice": "rgb(221, 0, 147)",
    "guru": "rgb(136, 45, 158)",
    "master": "rgb(41, 77, 219)",
    "enlightened": "rgb(0, 147, 221)",
    "burned": "rgb(240, 240, 240)"


            "about": STRING,
            "website": null || STRING,
            "twitter": null || STRING,
            "topics_count": INT,
            "posts_count": INT,
            "creation_date": SECONDS(INT)
        */
        this.update(data);
    };
    // TODO: twitter information (Need sample data)
    UserInformation.prototype.update = function(data) {
        this.data = data;
        for (var k in data) {
            this[k] = data[k];
        }
    };
    UserInformation.prototype.avatar_url = function(size) {
        // Get Gravatar URL
        var url = 'http://www.gravatar.com/avatar/' + this.gravatar;
        if (size) {
            // 1px - 2048px are accepted.
            url += '?s=' + size;
        }
        return url;
    };
    UserInformation.prototype.profile_url = function() {
        return 'http://www.wanikani.com/community/people/' + this.username;
    };
    UserInformation.prototype.image = function(size, cls, doc) {
        // Create Gravatar Image Element
        var e = (doc || document).createElement('img');
        if (size) {
            e.width = size;
            e.height = size;
        }
        if (cls) {
            e.setAttribute('class', cls);
        }
        e.src = this.avatar_url(size);
        return e;
    };
    UserInformation.prototype.weblink = function(text, cls, doc) {
        var e = (doc || document).createElement('a');
        e.href = this.website || this.profile_url();
        if (text) {
            e.innerText = text;
        }
        if (cls) {
            e.setAttribute('class', cls);
        }
        return e;
    };
    UserInformation.prototype.created = function() {
        return new Date(this.creation_date * 1000);
    };

    var Radical = function(data) {
        this.update(data);
    };
    Radical.prototype.referenceName = 'radicals';
    Radical.prototype.update = UserInformation.prototype.update;
    Radical.prototype.url = function() {
        return "http://www.wanikani.com/" + this.referenceName + "/" + this.character;
    };
    Radical.prototype.weblink = function(text, cls, doc) {
        var a = (doc || document).createElement('a');
        e.href = this.url();
        if (text) {
            e.innerText = text;
        }
        if (cls) {
            e.setAttribute('class', cls);
        }
        return e;
    };
    Radical.prototype.isUnlocked = function() {
        return this.stats !== null;
    };
    Radical.prototype.burnedDate = function() {
        return new Date(this.stats.burned_date * 1000);
    };
    Radical.prototype.unlockedDate = function() {
        return new Date(this.stats.unlocked_date * 1000);
    };
    Radical.prototype.availableDate = function() {
        return new Date(this.stats.available_date * 1000);
    };

    var RadicalCollection = function(radicals) {
        this.update(radicals || []);
    };
    RadicalCollection.prototype.update = function(data) {
        this.data = this.data || [];
        var c;
        for (var i=0; i<data.length; i++) {
            c = this.getByCharacter(data[i].character);
            if (c) {
                c.update(data[i]);
            } else {
                this.data.push(new this.entClass(data[i]));
            }
        }
        this.sort();
    };
    RadicalCollection.prototype.sort = function(fn) {
        if (!fn) {
            fn = function(a, b) {
                return parseInt(a.level, 10) - parseInt(b.level, 10);
            };
        }
        this.data.sort(fn);
    };
    RadicalCollection.prototype.cacheKey = function(character) {
        return this.referenceName() + '/character-' + character.character;
    };
    RadicalCollection.prototype.levelCacheKey = function(level) {
        return this.referenceName() + '/level-' + level;
    };
    RadicalCollection.prototype.cacheStore = function(user) {
        // var set_levels = [], character;
        for (var i=0; i<this.data.length; ++i) {
            character = this.data[i];
            // if (!(character.level in set_levels)) {
            //     user.cacheSet(this.levelCacheKey(character.level), true);
            //     set_levels.push(character.level);
            // }
            user.cacheSet(this.cacheKey(character), character.data);
        }
    };
    RadicalCollection.prototype.has_level = function(level) {
        // return user.cacheGet(this.levelCacheKey(level));
        for (var i=0; i<this.data.length; ++i) {
            if (this.data[i].level == level) {
                return true;
            }
        }
        return false;
    };
    RadicalCollection.prototype.has_argument = RadicalCollection.prototype.has_level;
    RadicalCollection.prototype.filter_arguments = function(args) {
        var new_args = [];
        for (var i=0; i<args.length; ++i) {
            if (!this.has_argument(args[i])) {
                new_args.push(args[i]);
            }
        }
        return new_args;
    };
    RadicalCollection.prototype.cacheLoad = function(user) {
        var raw = user.cacheGetPrefix(this.referenceName() + '/character-');
        var array = [];
        for (var k in raw) {
            array.push(raw[k]);
        }
        this.update(array);
    };
    RadicalCollection.prototype.filterStale = RadicalCollection.prototype.cacheLoad;
    RadicalCollection.prototype.entClass = Radical;
    RadicalCollection.prototype.referenceName = function() {
        return this.entClass.prototype.referenceName;
    };
    RadicalCollection.prototype.toArray = function() {
        return this.data;
    };
    RadicalCollection.prototype.getByCharacter = function(character) {
        for (var i=0; i<this.data.length; ++i) {
            if (this.data[i].character == character) {
                return this.data[i];
            }
        }
        return undefined;
    };

    var Kanji = function(data) {
        this.update(data);
    };
    copy_prototype(Radical, Kanji);
    Radical.prototype.referenceName = 'kanji';

    KanjiCollection = function(kanji) {
        this.update(kanji || []);
    };
    copy_prototype(RadicalCollection, KanjiCollection);
    KanjiCollection.prototype.entClass = Kanji;

    var Vocab = function(data) {
        this.update(data);
    };
    copy_prototype(Radical, Vocab);
    Radical.prototype.referenceName = 'vocabulary';

    VocabCollection = function(vocab) {
        this.update(vocab || []);
    };
    copy_prototype(RadicalCollection, VocabCollection);
    VocabCollection.prototype.entClass = Vocab;


    var User = function(api_key) {
        this.api_key = api_key;
        this.load_from_cache();

        // These callbacks fire after every successful query
        this._onsuccess = [];
    };
    User.prototype.field_formats = {
        information: UserInformation,
        study_queue: null,
        level_progression: null,
        srs_distribution: null,
        recent_unlocks: null,
        critical_items: null,
        radicals: RadicalCollection,
        kanji: KanjiCollection,
        vocabulary: VocabCollection
    };
    User.prototype.load_from_cache = function() {
        var cache_check, field_type;
        for (var k in this.field_formats) {
            field_type = this.field_formats[k];
            if (field_type && field_type.prototype.cacheLoad) {
                this[k] = new field_type();
                this[k].cacheLoad(this);
            } else {
                cache_check = this.cacheGet(k);
                if (cache_check) {
                    if (field_type) {
                        this[k] = new field_type(cache_check);
                    } else {
                        this[k] = cache_check;
                    }
                } else {
                    this[k] = null;
                }
            }
        }
    };
    User.prototype.apiURI = function() {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(this.api_key);
        return getURI.apply(null, args);
    };
    User.prototype.__unique_key = function() {
        return 'wk-user/' + this.api_key;
    };
    User.prototype.cacheSet = function(key, value) {
        return storage.setValue(this.__unique_key() + '/' + key, value);
    };
    User.prototype.cacheGet = function(key) {
        return storage.getValue(this.__unique_key() + '/' + key);
    };
    User.prototype.cacheGetPrefix = function(prefix) {
        return storage.getPrefix(this.__unique_key() + '/' + prefix);
    };
    User.prototype.cacheEmpty = function() {
        storage.deletePrefix(this.__unique_key());
    };
    User.prototype.clear = function() {
        // Forget everything about this user.
        this.cacheEmpty();
        this.load_from_cache();
    };
    User.prototype.forget = User.prototype.clear;
    User.prototype.__query = function(resource, success, error, args, context) {
        var self = this;
        var success_wrapper = function(response) {
            if (response.error) {
                error.call(self, response.error);
            } else {
                self.onsuccess.apply(self, arguments);
                success.apply(context, arguments);
            }
        };
        if (args && args.length > 0) {
            args = args.map(function(e) { return e.toString(); }).join(',');
        } else {
            args = '';
        }

        jsonp_query(this.apiURI(resource, args), success_wrapper, error, context);
    };
    User.prototype.onsuccess = function(response) {
        if (response.user_information) {
            if (this.information) {
                this.information.update(response.user_information);
            } else {
                this.information = new UserInformation(response.user_information);
            }
            this.cacheSet('information', response.user_information);
        }
        for (var i; i<this._onsuccess.length; i++) {
            try {
                this._onsuccess[i].apply(null, arguments);
            } catch(e) {
                console.log('caught success-callback error', e);
            }
        }
    };
    User.prototype.withInfo = function() {
        var promise = new SimplePromise();
        if (this.information) {
            promise.doSuccess(this);
        } else {
            var self = this;
            var success_wrapper = function(response) {
                self.onsuccess(response);
                promise.doSuccess(self);
            };

            this.__query('user-information',
                success_wrapper,
                function() { promise.doError.apply(promise, arguments); }
            );
        }
        return promise;
    };

    var _generate_query_fn = function(api_name, key_name) {
        var wrapper = User.prototype.field_formats[key_name];
        return function() {
            var required_args = Array.prototype.slice.call(arguments, 0);
            if (this[key_name] && this[key_name].filter_arguments) {
                required_args = this[key_name].filter_arguments(required_args);
            }


            var promise = new SimplePromise();
            if (this[key_name] && required_args.length === 0) {
                promise.doSuccess(this);
            } else {
                var self = this;
                var success = function(response) {
                    if (wrapper) {
                        if (self[key_name]) {
                            self[key_name].update(response.requested_information);
                        } else {
                            self[key_name] = new wrapper(response.requested_information);
                        }
                    } else {
                        self[key_name] = response.requested_information;
                    }
                    if (self[key_name].cacheStore) {
                        self[key_name].cacheStore(self);
                    } else {
                        self.cacheSet(key_name, self[key_name]);
                    }

                    self.onsuccess(response);
                    promise.doSuccess(self);
                };

                this.__query(api_name,
                    success,
                    function() { promise.doError.apply(promise, arguments); },
                    required_args,
                    this
                );
            }
            return promise;
        };
    };
    User.prototype.withStudyQueue = _generate_query_fn(
        // No available arguments
        "study-queue", "study_queue"
    );
    User.prototype.withLevelProgression = _generate_query_fn(
        // No Available arguments
        "level-progression", "level_progression"
    );
    User.prototype.witSRSDistribution = _generate_query_fn(
        "srs-distribution", "srs_distribution"
    );
    User.prototype.withRecentUnlocks = _generate_query_fn(
        // takes a limit argument,  0-100
        "recent-unlocks", "recent_unlocks"
    );
    User.prototype.withCriticalItems = _generate_query_fn(
        // takes a percentage argument,  0-100
        "critical-items", "critical_items"
    );
    User.prototype.withRadicals = _generate_query_fn(
        // takes a level argument,  currently 1-30
        "radicals", "radicals"
    );
    User.prototype.withKanji = _generate_query_fn(
        // takes a level argument,  currently 1-30
        "kanji", "kanji"
    );
    User.prototype.withVocab = _generate_query_fn(
        // takes a level argument,  currently 1-30
        "vocabulary", "vocabulary"
    );

    // SRS Card Levels
    var levels = {
        "apprentice": {
            "level": 0,
            "colors": {
                "dark": "FF00AA",
                "light": "DD0093"
            }
        },
        "guru": {
            "level": 1,
            "colors": {
                "dark": "AA38C6",
                "light": "882D9E"
            }
        },
        "master": {
            "level": 2,
            "colors": {
                "dark": "5571E2",
                "light": "294BBD"
            }
        },
        "enlighten": {
            "level": 3,
            "colors": {
                "dark": "00AAFF",
                "light": "0093DD"
            }
        },
        "burned": {
            "level": 4,
            "colors": {
                "dark": "555555",
                "light": "434343"
            }
        }
    };

    return {
        JSONP: JSONP,
        setMaxCacheTime: storage.setMaxAge,
        levels: levels,
        // storage: storage,
        getUser: function(api_key) {
            if (!users[api_key]) {
                users[api_key] = new User(api_key);
            }
            return users[api_key];
        },
        forgetUser: function(api_key) {
            users[api_key].cacheEmpty();
            delete users[api_key];
        }
    };

})(window, document);
