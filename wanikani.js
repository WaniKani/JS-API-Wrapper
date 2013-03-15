/*
    JS WaniKani API Wrapper
    (c) 2012 Daniel Bowring

    TODO: testing

    Basic usage:

        // Get a user
        user = wanikani.getUser(API_KEY);

        // Get User Information
        user.withUserInfo().then(function(user) {
            console.log(user.info.username());
        });

    Object Tree:
        - User
            - .getInfo() -> SimplePromise
            - .getStudyQueue() -> SimplePromise
            - .getLevelProgression() -> SimplePromise
            - .getSRSDistribution() -> SimplePromise
            - .getRecentUnlocks(count=10) -> SimplePromise
            - .getCriticalItems(percentage=75) -> SimplePromise
            - .getRadicals(level=1..user.info.level()) -> SimplePromise
            - .getKanji(level=1..user.info.level()) -> SimplePromise
            - .getVocab(level=1..user.info.level()) -> SimplePromise
        - SimplePromise
            - then(success=null, error=null, complete=null, context=null) -> SimplePromise
            - onSuccess(fn, context=null) -> SimplePromise
            - onError(fn, context=null) -> SimplePromise
            - onComplete(fn, context=null) -> SimplePromise
        - Character (Radical or Vocab or Kanji)
            - .stats() -> CharacterStats
            - .url() -> String // WaniKani URL
            - .weblink(tetx, css_class='', doc=window.document) -> HTMLAnchorElement
            - .isUnlocked() -> Boolean
        - CharacterStats
            - .srs() -> String
            - .unlocked_data() -> Date
            - .available_date() -> Date
            - .burned() -> Boolean
            - .burned_date() -> Date
            - .meaning_correct() -> Integer or null
            - .meaning_incorrect() -> Integer or null
            - .meaning_max_streak() -> Integer or null
            - .meaning_current_streak() -> Integer or null
            - .reading_correct() -> Integer or null
            - .reading_incorrect() -> Integer or null
            - .reading_max_streak() -> Integer or null
            - .reading_current_streak() -> Integer or null
        - Radical
            - .character() -> String
            - .meaning() -> String
            - .image() -> String or null
            - .level() -> Integer
            - .percentage() -> Integer or null
        - Kanji
            - .character() -> String
            - .meaning() -> String
            - .onyomi() -> String
            - .kunyomi() -> String
            - .important_reading() -> String
            - .level() -> Integer
            - .percentage() -> Integer or null
        - Vocab
            - .character() -> String
            - .kana() -> String
            - .meaning() -> String
            - .level() -> Integer
            - .percentage() -> Integer

    User Interface:
        (assuming user is a User instance)
        - user.info -> UserInformation
            - .username() -> String
            - .gravatar() -> String
            - .level() -> Integer
            - .title() -> String
            - .about() -> String
            - .website() -> String or null
            - .twitter() -> String
            - .topics_count() -> Integer
            - .creation_date -> Date
            - .avatar_url(size=null) -> String
            - .profile_url() -> String
            - .twitter_url() -> String,
            - .image(size, css_class='', doc=window.document) -> HTMLImageElement
            - .weblink(text, css_class='', doc=window.document) -> HTMLAnchorElement
            - .data -> Object (raw query data)
        - user.study_queue -> StudyQueue
            - .lessions_available() -> Integer
            - .reviews_available() -> Integer
            - .next_review_date() -> Date
            - .reviews_available_next_hour() -> Integer
            - .reviews_available_next_day() -> Integer
            - .data -> Object // raw query data
        - user.level_progression -> Object
            - .radicals_progress() -> Integer
            - .radicals_total() -> Integer
            - .kanji_progress() -> Integer
            - .kanji_total() -> Integer
            - .data -> Object // raw query data
        - user.srs_distribution -> Object
            // Note that this is the raw data from the query
            - .apprentice -> Object
                - .radicals -> Integer
                - .kanji -> Integer
                - .vocabulary -> Integer
                - .total -> Integer
            -.guru, .master, .enlighten, .burn
                // Same as .apprentice
        - user.recent_unlocks -> RecentUnlocksCollection
            - .getByTypeCharacter(type, character) -> Character or undefined
                // Where type is 'radical', 'vocabulary' or 'kanji'
            - .getByCharacter(character) -> Array[Character]
            - .toArray() -> Array[Character]
                // Note that you SHOULD NOT modify this array - it is a
                // reference to the internal data store.
                // If you require a copy, use .toArray().slice(0);
        - user.critical_items -> CriticalItemsCollection
            // Same as user.recent_unlocks
        - user.radicals -> RadicalCollection
            - .getByCharacter(character) -> Radical
        - user.kanji -> KanjiCollection
            // Same as user.radicals, but returns Kanji types
        - user.vocabulary -> VocabCollection
            // same as user.radicals, but returns Vocab types

    General documentation on the API can be found at
    http://www.wanikani.com/api
    If you want to access a value that is not wrapped, use object.data[key]
    Note, however, it will not be cached (and so may not always be present)

    All objects support JSON serialization - for example:
    user.wrapper.update(JSON.parse(JSON.generate(user.wrapper)))
*/

var wanikani = (function(window, document) {
    "use strict";
    var users = {};
    var url_base = 'http://www.wanikani.com';
    var api_path = 'api/v1.1/user';
    var getURI = function() {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(url_base);
        return args.join('/');
    };
    var getAPIURI = function() {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(api_path);
        return getURI.apply(null, args);
    };

    var extend = function(cls, data) {
        for (var k in data) {
            cls.prototype[k] = data[k];
        }
        return cls;
    };
    var copy_prototype = function(source, destination) {
        for (var k in source.prototype) {
            destination.prototype[k] = source.prototype[k];
        }
    };
    var read_data_key = function(key) {
        return function() {
            return this.data[key];
        };
    };
    var class_implements = function(cls, intf, overrides) {
        var k;
        for (k in intf) {
            cls.prototype[k] = intf[k];
        }
        if (overrides) {
            for (k in overrides) {
                cls.prototype[k] = overrides[k];
            }
        }
    };

    var storage = (function() {
        /*
        This allows for queried data to be cached (since it hardly changed);
        */
        var support = 'localStorage' in window && window.localStorage !== null;
        support = support && 'JSON' in window && window.JSON !== null;
        // var max_lifespan = 60 * 60 * 24 * 1000;  // 24 Hours
        var max_lifespan = 60 * 60 * 2 * 1000;  // 2 Hours
        var getItem, setItem;

        var cache = support ? window.localStorage : ({});

        var isStale = function(container) {
            return new Date() > new Date(container.created + max_lifespan);
        };
        var isKeyStale = function(key) {
            return isStale(getItem(key));
        };
        var stamp = function(data) {
            return {
                created: new Date().getTime(),
                data: data
            };
        };
        var has = function(key) {
            return key in cache;
        };
        var removeItem = function(key) {
            delete cache[key];
        };
        var setMaxAge = function(milliseconds) {
            max_lifespan = milliseconds;
        };
        var getMaxAge = function() {
            return max_lifespan;
        };

        var withPrefix = function(prefix, fn, context) {
            for (var k in cache) {
                if (k.indexOf(prefix) === 0) {
                    fn.call(context, k, k.slice(prefix.length));
                }
            }
        };

        if (support) {
            setItem = function(key, value) {
                cache[key] = JSON.stringify(stamp(value));
            };
            getItem = function(key) {
                if (key in cache) {
                    var stamped = JSON.parse(cache[key]);
                    if (isStale(stamped)) {
                        removeItem(key);
                        return undefined;
                    }
                    return stamped.data;
                }
                return undefined;
            };
        } else {
            setItem = function(key, value) {
                cache[key] = stamp(value);
            };
            getItem = function(key) {
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

        var CacheAccess = function(base_key) {
            this.base_key = base_key;
        };
        extend(CacheAccess, {
            usesLocalStorage: support,
            getKey: function() {
                if (arguments.length === 0 || arguments[0] === null || arguments[0] === undefined) {
                    return this.base_key + '/';
                } else {
                    var args = Array.prototype.slice.call(arguments, 0);
                    args.unshift(this.base_key);
                    return args.join('/');
                }
            },
            getChild: function(subkey) {
                return new CacheAccess(this.getKey(subkey));
            },
            set: function(key, value) {
                setItem(this.getKey(key), value);
            },
            get: function(key) {
                return getItem(this.getKey(key));
            },
            has: function(key) {
                return has(this.getKey(key));
            },
            removeKey: function(key) {
                removeItem(this.getKey(key));
            },
            removePrefix: function(prefix) {
                withPrefix(this.getKey(prefix), function(k, lk) {
                    removeItem(k);
                });
            },
            removeStale: function(prefix) {
                withPrefix(this.getKey(prefix), function(k, lk) {
                    if (isKeyStale(k)) {
                        removeItem(k);
                    }
                });
            },
            keys: function(prefix) {
                var result = [];
                withPrefix(this.getKey(prefix), function(k, lk) {
                    if (get(k) !== undefined) {
                        result.push(lk);
                    }
                });
                return result;
            },
            toObject: function(prefix) {
                var result = {}, item;
                withPrefix(this.getKey(prefix), function(k, lk) {
                    item = getItem(k);
                    if (item !== undefined) {
                        result[lk] = item;
                    }
                });
                return result;
            },
            clear: function(prefix) {
                withPrefix(this.getKey(prefix), function(k, lk) {
                    removeKey(k);
                });
            },
            withMaxAge: function(max_age, fn, context) {
                var old = getMaxAge(), result;
                setMaxAge(max_age);
                try {
                    result = fn.call(context, this);
                } finally {
                    setMaxAge(old);
                }
                return result;
            }
        });

        return new CacheAccess('wanikani');
    })();


    var JSONP = {
        // TODO: Abstract this away so it's not tied to JSONP-style requests
        callbacks: {},
        nextID: 0,
        globalize: function(fn, context) {
            var self = this;
            var id = 'n' + (++this.nextID);
            var wrapper = function() {
                delete self.callbacks[id];
                fn.apply(context, arguments);
            };
            this.callbacks[id] = wrapper;
            return 'wanikani.JSONP.callbacks.' + id;
        },
        query: function(url, success, error, context) {
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
            url += 'callback=' + this.globalize(success);
            script.src = url;

            (document.getElementsByTagName('body') ||
                document.getElementsByTagName('head'))[0].appendChild(script);
        },
        numQueries: function() {
            return this.nextID;
        }
    };


    var SimplePromise = function() {
        this.completed = false;
        this.succeded = null;

        this._success = [];
        this._error = [];
        this._complete = [];
    };
    extend(SimplePromise, {
        then: function(success, error, complete, context) {
            if (success) {
                this.onSuccess(success, context);
            }
            if (error) {
                this.onError(error, context);
            }
            if (complete) {
                this.onComplete(complete, context);
            }
        },
        onSuccess: function(fn, context) {
            if (this.succeded === true) {
                fn.apply(context, this._success);
            } else {
                this._success.push([fn, context]);
            }
            return this;
        },
        onComplete: function(fn, context) {
            if (this.completed) {
                fn.apply(context, this._complete);
            } else {
                this._complete.push([fn, context]);
            }
            return this;
        },
        onError: function(fn, context) {
            if (this.succeded === false) {
                fn.apply(context, this._error);
            } else {
                this._error.push([fn, context]);
            }
            return this;
        },
        resolve: function() {
            for (var i=0; i<this._success.length; ++i) {
                try {
                    this._success[i][0].apply(this._success[i][1], arguments);
                } catch(e) {
                    console.log('Error in promise callback', e);
                }
            }
            this.succeded = true;
            this._success = arguments;
            this.complete();
        },
        reject: function() {
            for (var i=0; i<this._error.length; ++i) {
                try {
                    this._error[i][0].apply(this._error[i][1], arguments);
                } catch(e) {
                    console.log('Error in promise callback', e);
                }
            }
            this.succeded = false;
            this._error = arguments;
            this.complete();
        },
        complete: function() {
            for (var i=0; i<this._complete.length; ++i) {
                try {
                    this._complete[i][0].apply(this._complete[i][1], arguments);
                } catch(e) {
                    console.log('Error in promise callback', e);
                }
            }
            this.completed = true;
        }
    });

    var ItemInterface = {
        /**
        * Defines the minimal interface for Item objects (Radicals, ...)
        */
        // identifyingKeys: ["character", "type"],
        identityKey: 'username',
        subIdentityKey: null,
        update: function(data) {
            /**
            * Update this object with new information. This is a total
            * overwrite, all previous information is lost.
            *
            * @method update
            * @param {Object} 
            */
            this.data = data;
        },
        toJSON: function() {
            return this.data;
        },
        isSameAs: function(json) {
            /**
            * Returns true is the JSON object represents the same entity as
            * this one (but doesn't necessarily have the same values);
            *
            * @method isSameAs
            * @param {Object}
            */
            return (
                (this.data[this.identityKey] == json[this.identityKey]) && (
                    !this.subIdentityKey || (
                        this.data[this.subIdentityKey] == json[this.subIdentityKey]
                    )
                )
            );
        },
        cacheKey: function() {
            throw "Undefined CacheKey";
        },
        cacheDump: function(storage) {
            // throw "Storage method undefined";
            storage.set(this.cacheKey(), this.data);
        },
        cacheLoad: function(storage) {
            // throw "Storage retrieval undefined";
            var stored = storage.get(this.cacheKey());
            if (stored !== undefined) {
                this.update(stored);
            }
        }
    };
    var CollectionInterface = {
        itemClass: undefined,
        update: function(items) {
            if (this.data === null || this.data === undefined) {
                this.data = [];
            }
            var item;
            for (var i=0; i<items.length; ++i) {
                item = this.getByJSON(items[i]);
                if (item === undefined) {
                    item = new this.itemClass(items[i]);
                    this.data.push(item);
                } else {
                    item.update(items[i]);
                }
            }
            this.sort();
        },
        getByJSON: function(json) {
            for (var i=0; i<this.data.length; ++i) {
                if (this.data[i].isSameAs(json)) {
                    return this.data[i];
                }
            }
            return undefined;
        },
        default_sort_function: function(a, b) {
            return a < b ? -1 : 1;
        },
        sort: function(fn) {
            return this.data.sort(fn || this.default_sort_function);
        },
        cacheKey: function() {
            throw "Undefined CacheKey";
        },
        cacheDump: function(storage) {
            // throw "Storage method undefined";
            storage.set(this.cacheKey(), this.data);
        },
        cacheLoad: function(storage) {
            // throw "Storage retrieval undefined";
            var stored = storage.get(this.cacheKey());
            if (stored !== undefined) {
                this.update(stored);
            }
        },
        canShortcut: function(parent, args) {
            console.log('Warning : Default canShortcut used');
            return false;
        },
        toArray: function() {
            // Should return a copy here?
            return this.data;
        }
    };

    var Types = {
        "Boolean": function(s) {
            return s;
        },
        "Object": function(s) {
            return s;
        },
        "String": function(s) {
            return s.toString();
        },
        "Integer": function(s) {
            return s;
            // return parseInt(s, 10);
        },
        "Percentage": function(s) {
            return parseInt(s, 10);
        },
        "Date": function(s) {
            return new Date(s * 1000);
        },
        "NullOr": function(other) {
            return function(s) {
                if (s === null || s === undefined) {
                    return s;
                }
                return other(s);
            };
        }
    };
    var add_data_reader = function(cls, k, wrapper) {
        if (wrapper) {
            cls.prototype[k] = function() {
                return wrapper(this.data[k]);
            };
        } else {
            cls.prototype[k] = function() {
                return this.data[k];
            };
        }
    };
    var add_data_types = function(cls, types) {
        for (var k in types) {
            add_data_reader(cls, k, types[k]);
        }
    };

    var UserInformation = function(data) {
        this.update(data);
    };
    UserInformation.known_data_keys = {
        username: Types.String,
        gravatar: Types.String,  // Always 32 characters long
        level: Types.Integer,
        title: Types.String,
        about: Types.String,
        website: Types.NullOr(Types.String),
        twitter: Types.String,
        topics_count: Types.Integer,
        posts_count: Types.Integer,
        creation_date: Types.Date
    };
    add_data_types(UserInformation, UserInformation.known_data_keys);

    class_implements(UserInformation, ItemInterface, {
        cacheKey: function() {
            return 'info';
        }
    });
    extend(UserInformation, {
        avatar_url: function(size) {
            var url = 'http://www.gravatar.com/avatar/' + this.gravatar();
            if (size) {
                // 1px - 2048px are accepted.
                url += '?s=' + size;
            }
            return url;
        },
        profile_url: function() {
            return 'http://www.wanikani.com/community/people/' + this.username();
        },
        twitter_url: function() {
            return 'https://twitter.com/' + this.twitter();
        },
        image: function(size, cls, doc) {
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
        },
        weblink: function(text, cls, doc) {
            var e = (doc || document).createElement('a');
            e.href = this.website() || this.profile_url();
            if (text) {
                e.innerText = text;
            }
            if (cls) {
                e.setAttribute('class', cls);
            }
            return e;
        }
    });

    // KanaStatsInterface = {};

    var KanaInterface = {
        identityKey: 'character',
        referenceName: 'UNDEFINED!',
        statsClass: undefined,
        update: function(data) {
            this.data = data;
            this._stats = new this.statsClass(data.stats);
        },
        stats: function() {
            /**
            * This allows the stats the be accessed in the same manner as the
            * rest of the attributes (as a function)
            *
            * @method stats
            */
            return this._stats;
        },
        url: function() {
            return getURI(this.referenceName, this.character());
        },
        weblink: function(text, cls, doc) {
            var a = (doc || document).createElement('a');
            e.href = this.url();
            if (text) {
                e.innerText = text;
            }
            if (cls) {
                e.setAttribute('class', cls);
            }
            return e;
        },
        isUnlocked: function() {
            return this.stats !== null;
        }
    };

    var CharacterCollectionInterface = {
        cacheLoad: function(storage) {
            storage = storage.getChild(this.cacheKey());
            var new_data = [], stored = storage.toObject();
            for (var k in stored) {
                new_data.push(stored[k]);
            }
            this.update(new_data);
        },
        cacheDump: function(storage) {
            storage = storage.getChild(this.cacheKey());
            var character;
            for (var i=0; i<this.data.length; ++i) {
                character = this.data[i];
                storage.set(character.character(), character.data);
            }
        },
        has_level: function(level) {
            console.log('checking', level);
            for (var i=0; i<this.data.length; ++i) {
                if (this.data[i].level() == level) {
                    return true;
                }
            }
            return false;
        },
        getByCharacter: function(character) {
            for (var i=0; i<this.data.length; ++i) {
                if (this.data[i].character() == character) {
                    return this.data[i];
                }
            }
            return undefined;
        },
        getLevels: function() {
            // Returns all characters, the level of which was included in the
            // arguments. E.g., getLevels(1,3,5) wil lreturn all kana of levels
            // 1, 3 and 5.
            var items = [], check = {}, i;
            for (i=0; i<arguments.length; i++) {
                // We have to do this otherwise the "in" check later will be
                // checking against index, not value.
                check[arguments[i]] = true;
            }
            for (i=0; i<this.data.length; ++i) {
                if (this.data[i].level in check) {
                    items.push(this.data[i]);
                }
            }
            return items;
        },
        canShortcut: function(user, args) {
            // Return true if the given args are already present, and a query can
            // be skipped.
            if (user.info.level === undefined) {
                // Don't know what level we can query up to - so this can not
                // be skipped
                return false;
            }
            // For a radical/kanji/vocab query, the arguments are the levels to
            // query, defaulting to all up to the users level.
            // if we find any level that hasn't been queried, we can't shortcut
            args = args || [];
            console.log(args);
            var i;
            if (args.length === 0) {
                // Start at one because there is no level 0 :)
                for (i=1; i<user.info.level(); ++i) {
                    if (!this.has_level(args[i])) {
                        return false;
                    }
                }
            } else {
                for (i=0; i<args.length; ++i) {
                    console.log(args[i]);
                    if (!this.has_level(args[i])) {
                        console.log('cannot shortcut (missing', args[i], ')');
                        return false;
                    }
                }
            }
            // We already have all the queried levels, so we can shortcut safely!
            console.log('can shortcut');
            return true;
        },
        filter_arguments: function(args) {
            var new_args = [];
            for (var i=0; i<args.length; ++i) {
                if (!this.has_argument(args[i])) {
                    new_args.push(args[i]);
                }
            }
            if (args.length > 0 && new_args.length === 0) {
                // Everything asked for is available
                return null;
            }
            return new_args;
        }
    };

    var CharacterStats = function(data) {
        this.update(data);
    };
    CharacterStats.known_data_keys = {
        srs: Types.String,
        unlocked_date: Types.Date,
        available_date: Types.Date,
        burned: Types.Boolean,
        burned_date: Types.Date,
        meaning_correct: Types.NullOr(Types.Integer),
        meaning_incorrect: Types.NullOr(Types.Integer),
        meaning_max_streak: Types.NullOr(Types.Integer),
        meaning_current_streak: Types.NullOr(Types.Integer),
        reading_correct: Types.NullOr(Types.Integer),
        reading_incorrect: Types.NullOr(Types.Integer),
        reading_max_streak: Types.NullOr(Types.Integer),
        reading_current_streak: Types.NullOr(Types.Integer)
    };
    add_data_types(CharacterStats, CharacterStats.known_data_keys);

    class_implements(CharacterStats, ItemInterface, {
        isSameAs: function(other) {
            return false;  // Not possible to externally check.
        }
    });

    var Radical = function(data) {
        this.update(data);
    };
    Radical.known_data_keys = {
        character: Types.String,
        meaning: Types.String,
        image: Types.NullOr(Types.String),
        level: Types.Integer,
        percentage: Types.NullOr(Types.Percentage)
        // stats: Types.Object
    };
    add_data_types(Radical, Radical.known_data_keys);

    class_implements(Radical, ItemInterface);
    class_implements(Radical, KanaInterface, {
        referenceName: 'radical',
        statsClass: CharacterStats,
        subIdentityKey: 'type'
    });


    var RadicalCollection = function(radicals) {
        this.update(radicals || []);
    };
    class_implements(RadicalCollection, CollectionInterface);
    class_implements(RadicalCollection, CharacterCollectionInterface, {
        itemClass: Radical,
        referenceName: Radical.prototype.referenceName,
        cacheKey: function() {
            return 'radicals';
        }
    });

    var Kanji = function(data) {
        this.update(data);
    };
    Kanji.known_data_keys = {
        character: Types.String,
        meaning: Types.String,
        onyomi: Types.String,
        kunyomi: Types.String,
        important_reading: Types.String,
        level: Types.Integer,
        percentage: Types.NullOr(Types.Percentage)
        // stats: Types.Object
    };
    add_data_types(Kanji, Kanji.known_data_keys);
    class_implements(Kanji, ItemInterface);
    class_implements(Kanji, KanaInterface, {
        referenceName: 'kanji',
        statsClass: CharacterStats,  // They are the same :)
        subIdentityKey: 'type'
    });

    var KanjiCollection = function(kanji) {
        this.update(kanji || []);
    };
    class_implements(KanjiCollection, CollectionInterface);
    class_implements(KanjiCollection, CharacterCollectionInterface, {
        itemClass: Kanji,
        referenceName: Kanji.prototype.referenceName,
        cacheKey: function() {
            return 'kanji';
        }
    });

    var Vocab = function(data) {
        this.update(data);
    };
    Vocab.known_data_keys = {
        character: Types.String,
        kana: Types.String,
        meaning: Types.String,
        level: Types.Integer,
        percentage: Types.NullOr(Types.Percentage)
        // stats: Types.Object
    };
    add_data_types(Vocab, Vocab.known_data_keys);
    class_implements(Vocab, ItemInterface);
    class_implements(Vocab, KanaInterface, {
        referenceName: 'vocabulary',
        statsClass: CharacterStats,  // They are the same :)
        subIdentityKey: 'type'
    });

    var VocabCollection = function(kanji) {
        this.update(kanji || []);
    };
    class_implements(VocabCollection, CollectionInterface);
    class_implements(VocabCollection, CharacterCollectionInterface, {
        itemClass: Vocab,
        referenceName: Vocab.prototype.referenceName,
        cacheKey: function() {
            return 'vocabulary';
        }
    });

    var StudyQueue = function(data) {
        this.data =  data;
    };
    StudyQueue.prototype.known_data_types = {
        lessions_available: Types.Integer,
        reviews_available: Types.Integer,
        next_review_date: Types.Date,
        reviews_available_next_hour: Types.Integer,
        reviews_available_next_day: Types.Integer
    };
    add_data_types(StudyQueue, StudyQueue.known_data_keys);

    var LevelProgression = function(data) {
        this.data =  data;
    };
    LevelProgression.prototype.known_data_types = {
        radicals_progress: Types.Integer,
        radicals_total: Types.Integer,
        kanji_progress: Types.Integer,
        kanji_total: Types.Integer
    };
    add_data_types(LevelProgression, LevelProgression.known_data_keys);


    var RecentUnlocksCollection = function(data) {
        this.update(data || []);
    };
    class_implements(RecentUnlocksCollection, CollectionInterface);
    class_implements(RecentUnlocksCollection, CharacterCollectionInterface);
    extend(RecentUnlocksCollection, {
        itemClass: null,
        referenceName: 'recent-unlocks',
        update: function(items) {
            if (this.data === null || this.data === undefined) {
                this.data = [];
            }
            var item;
            for (var i=0; i<items.length; ++i) {
                item = this.getByJSON(items[i]);
                if (item === undefined) {
                    if (items[i].type == 'kanji') {
                        item = new Kanji(items[i]);
                    } else if (items[i].type == 'radical') {
                        item = new Radical(items[i]);
                    } else if (items[i].type == 'vocabulary') {
                        item = new Vocab(items[i]);
                    }
                    this.data.push(item);
                } else {
                    item.update(items[i]);
                }
            }
            this.sort();
        },
        cacheKey: function() {
            return 'recent-unlocks';
        },
        canShortcut: function(limit) {
            //Declaring a limit is available, as seen in the example as 3
            // The limit can be a minimum of 1 and a maximum of 100.
            // If the limit argument is not specified or outside the range, a default of 10 will be used.
            if (limit === null || limit === undefined || limit < 1 || limit > 100) {
                limit = 10;
            }
            return limit <= data.length;
        },
        filter_arguments: function(limit) {
            limit = limit[0];
            if (limit === null || limit === undefined || limit < 1 || limit > 100) {
                limit = 10;
            }
            if (limit <= this.data.length) {
                // Everything asked for is available
                return null;
            }
            return [limit];
        },
        cacheLoad: function(storage) {
            storage = storage.getChild(this.cacheKey());
            var new_data = [], stored = storage.toObject();
            for (var k in stored) {
                new_data.push(stored[k]);
            }
            this.update(new_data);
        },
        cacheDump: function(storage) {
            storage = storage.getChild(this.cacheKey());
            var character;
            for (var i=0; i<this.data.length; ++i) {
                character = this.data[i];
                storage.set(character.referenceName + '/' +character.character(), character.data);
            }
        },
        getByTypeCharacter: function(type, character) {
            var c;
            for (var i=0; i<this.data.length; ++i) {
                c = this.data[i];
                if (c.type() == type && c.character() == character) {
                    return c;
                }
            }
        },
        getByCharacter: function(character) {
            var result = [];
            for (var i=0; i<this.data.length; ++i) {
                if (this.data[i].character() == character) {
                    result.push(this.data[i]);
                }
            }
            return result;
        }
    });

    var CriticalItemsCollection = function(data) {
        this.update(data || []);
    };
    class_implements(CriticalItemsCollection, CollectionInterface);
    class_implements(CriticalItemsCollection, CharacterCollectionInterface);
    extend(CriticalItemsCollection, {
        itemClass: null,
        referenceName: 'critical-items',
        update: function(items) {
            if (this.data === null || this.data === undefined) {
                this.data = [];
            }
            var item;
            for (var i=0; i<items.length; ++i) {
                item = this.getByJSON(items[i]);
                if (item === undefined) {
                    if (items[i].type == 'kanji') {
                        item = new Kanji(items[i]);
                    } else if (items[i].type == 'radical') {
                        item = new Radical(items[i]);
                    } else if (items[i].type == 'vocabulary') {
                        item = new Vocab(items[i]);
                    }
                    this.data.push(item);
                } else {
                    item.update(items[i]);
                }
            }
            this.sort();
        },
        cacheKey: function() {
            return 'critical-items';
        },
        canShortcut: function(limit) {
            // This one is a little more "guess-y"
            if (limit === null || limit === undefined || limit < 0 || limit > 100) {
                limit = 75;
            }
            for (var i=0; i < this.data.length; ++i) {
                if (this.data[i].percentage() >= limit) {
                    return true;
                }
            }
            return false;
        },
        filter_arguments: function(limit) {
            limit = limit[0];
            if (limit === null || limit === undefined || limit < 0 || limit > 100) {
                limit = 75;
            }
            for (var i=0; i < this.data.length; ++i) {
                if (this.data[i].percentage() >= limit) {
                    return null;
                }
            }
            return [limit];
        },
        cacheLoad: function(storage) {
            storage = storage.getChild(this.cacheKey());
            var new_data = [], stored = storage.toObject();
            for (var k in stored) {
                new_data.push(stored[k]);
            }
            this.update(new_data);
        },
        cacheDump: function(storage) {
            console.log('new dumper');
            storage = storage.getChild(this.cacheKey());
            var character;
            for (var i=0; i<this.data.length; ++i) {
                character = this.data[i];
                storage.set(character.referenceName + '/' +character.character(), character.data);
            }
        },
        getByTypeCharacter: function(type, character) {
            var c;
            for (var i=0; i<this.data.length; ++i) {
                c = this.data[i];
                if (c.type() == type && c.character() == character) {
                    result.push(this.data[i]);
                }
            }
        },
        getByCharacter: function(character) {
            var result = [];
            for (var i=0; i<this.data.length; ++i) {
                if (this.data[i].character() == character) {
                    result.push(this.data[i]);
                }
            }
            return result;
        }
    });

    var SRSDistribution = function(data) {
        this.data = data;
    };
    SRSDistribution.prototype.known_data_types = {
        radicals: Types.Integer,
        kanji: Types.Integer,
        vocab: Types.Integer,
        total: Types.Integer
    };
    add_data_types(SRSDistribution, SRSDistribution.known_data_keys);

    var SRSDistibutionCollection = function(data) {
        this.update(data);
    };



    var User = function(api_key) {
        this.api_key = api_key;
        this.storage = storage.getChild('user/' + api_key);
        this._load_from_cache();
    };
    User.prototype.field_formats = {
        info: UserInformation,
        study_queue: StudyQueue,
        level_progression: LevelProgression,
        srs_distribution: null,
        recent_unlocks: RecentUnlocksCollection,
        critical_items: CriticalItemsCollection,
        radicals: RadicalCollection,
        kanji: KanjiCollection,
        vocabulary: VocabCollection
    };

    var _generate_query_fn = function(api_name, key_name) {
        /**
         * This is used to generate (most) of the query functions.
         * Takes care of argument filtering, shortcut testing and caching
         */
        var Wrapper = User.prototype.field_formats[key_name];
        return function() {
            var args = Array.prototype.slice.call(arguments, 0);
            var gave_arguments = args.length > 0;
            var o = this[key_name];
            if (o && o.filter_arguments) {
                // Remove any arguments that aren't needed (information
                // already present)
                args = o.filter_arguments(args);
            }

            var promise = new SimplePromise();
            var has_shortcut = o && o.canShortcut === undefined;
            if ((gave_arguments && args === null) || (has_shortcut && o.canShortcut(this, args))) {
                // if (gave_arguments and filtered_all) or (has_shortcut and can_shortcut)
                promise.resolve(this);
            } else {
                var self = this;
                var success = function(response) {
                    if (Wrapper) {
                        if (self[key_name]) {
                            self[key_name].update(response.requested_information);
                        } else {
                            self[key_name] = new Wrapper(response.requested_information);
                        }
                    } else {
                        self[key_name] = response.requested_information;
                    }
                    if (self[key_name].cacheDump) {
                        self[key_name].cacheDump(self.storage);
                    } else {
                        this.storage.set(key_name, self[key_name]);
                    }
                    // Following ensures the user information is updated
                    self._response_success(response);
                    promise.resolve(self);
                };
                this.__query(api_name,
                    success,
                    function() { promise.reject.apply(promise, arguments); },
                    args,
                    this
                );
            }
            return promise;
        };
    };

    class_implements(User, ItemInterface, {
        identityKey: 'username',
        getAPIURL: function() {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(this.api_key);
            return getAPIURI.apply(null, args);
        },
        clear: function() {
            /**
             * Removes all information about this user from this object
             * and the cache. After calling this, you will need to
             * re-query any information
             */
            this.storage.removePrefix();
            this._load_from_cache();
        },
        ensureFresh: function(max_age) {
            /**
             * Removes any information from the user that is based on stale
             * information. Accepts one argument, a time (in seconds)
             * representing the maximum time which a query can be considered
             * "fresh"
             * If you do not call this, stale information will remain until
             * the instance is re-initialized
             */
            if (arguments.length === 0) {
                this.storage.removeStale();
            } else {
                this.storage.withMaxAge(max_age, function(s) {
                    s.removeStale();
                });
            }
            this._load_from_cache();
        },
        getInfo: function() {
            /**
             * Get basic user information. Most of the time you can avoid
             * calling this, because all other queries will include this
             * information
             *
             * @method getInfo
             * @return SimplePromise
             */
            var promise = new SimplePromise();
            if (this.info && this.info.data) {
                promise.resolve(this);
            } else {
                var self = this;

                this.__query('user-information',
                    function() { promise.resolve.apply(promise, arguments); },
                    function() { promise.reject.apply(promise, arguments); }
                );
            }
            return promise;
        },
        _response_success: function(response) {
            /**
            * Called after every successful query to update the users
            * information (as this data is given with every query)
            *
            * @method _response_success
            * @params {WANIKANI_RESPONSE}
            */
            if (response && response.user_information) {
                if (!this.info) {
                    this.info = new UserInformation(response.user_informtion);
                } else {
                    this.info.update(response.user_information);
                }
                this.info.cacheDump(this.storage);
            }
        },
        _load_from_cache: function() {
            var cache_check, Field_type;
            for (var k in this.field_formats) {
                this[k] = null;
                Field_type = this.field_formats[k];
                if (Field_type && Field_type.prototype.cacheLoad) {
                    this[k] = new Field_type();
                    this[k].cacheLoad(this.storage);
                } else {
                    cache_check = this.storage.get(k);
                    if (cache_check) {
                        if (field_type) {
                            this[k] = new Field_type(cache_check);
                        } else {
                            this[k] = cache_check;
                        }
                    }
                }
            }
        },
        __query: function(resource, success, error, args, context) {
            var self = this;
            var success_wrapper = function(response) {
                if (response.error) {
                    error.call(self, response.error);
                } else {
                    self._response_success.apply(self, arguments);
                    success.apply(context, arguments);
                }
            };
            if (args && args.length > 0) {
                args = args.map(function(e) { return e.toString(); }).join(',');
            } else {
                args = '';
            }

            // jsonp_query(this.getAPIURL(resource, args), success_wrapper, error, context);
            JSONP.query(this.getAPIURL(resource, args), success_wrapper, error, context);
        },
        // No available arguments
        getStudyQueue: _generate_query_fn("study-queue", "study_queue"),
        // No Available arguments
        getLevelProgression: _generate_query_fn("level-progression", "level_progression"),
        getSRSDistribution: _generate_query_fn("srs-distribution", "srs_distribution"),
        // takes a limit argument,  0-100
        getRecentUnlocks: _generate_query_fn("recent-unlocks", "recent_unlocks"),
        // takes a percentage argument,  0-100
        getCriticalItems: _generate_query_fn("critical-items", "critical_items"),
        // takes a level argument,  currently 1-30
        getRadicals: _generate_query_fn("radicals", "radicals"),
        // takes a level argument,  currently 1-30
        getKanji: _generate_query_fn("kanji", "kanji"),
        // takes a level argument,  currently 1-30
        getVocab: _generate_query_fn("vocabulary", "vocabulary")
    });

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
        // setMaxCacheTime: storage.setMaxAge,
        levels: levels,
        // storage: storage,
        user_info: UserInformation,
        getUser: function(api_key) {
            if (!users[api_key]) {
                users[api_key] = new User(api_key);
            }
            return users[api_key];
        }
        // forgetUser: function(api_key) {
        //     users[api_key].cacheEmpty();
        //     delete users[api_key];
        // }
    };

})(window, document);
