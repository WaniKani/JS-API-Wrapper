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


## Object Tree:
- User
    - `.getInfo()` -> `SimplePromise`
    - `.getStudyQueue()` -> `SimplePromise`
    - `.getLevelProgression()` -> `SimplePromise`
    - `.getSRSDistribution()` -> `SimplePromise`
    - `.getRecentUnlocks(count=10)` -> `SimplePromise`
    - `.getCriticalItems(percentage=75)` -> `SimplePromise`
    - `.getRadicals(level=1..user.info.level())` -> `SimplePromise`
    - `.getKanji(level=1..user.info.level())` -> `SimplePromise`
    - `.getVocab(level=1..user.info.level())` -> `SimplePromise`
- `SimplePromise`
    - `.then(success=null, error=null, complete=null, context=null)` -> `SimplePromise`
    - `.onSuccess(fn, context=null)` -> `SimplePromise`
    - `.onError(fn, context=null)` -> `SimplePromise`
    - `.onComplete(fn, context=null)` -> `SimplePromise`
- Character (Radical or Vocab or Kanji)
    - `.stats()` -> `CharacterStats`
    - `.url()` -> `String`
        - // WaniKani URL
    - `.weblink(tetx, css_class='', doc=window.document)` -> `HTMLAnchorElement`
    - `.isUnlocked()` -> `Boolean`
- CharacterStats
    - `.srs()` -> `String`
    - `.unlocked_data()` -> `Date`
    - `.available_`Date`()` -> `Date`
    - `.burned()` -> `Boolean`
    - `.burned_date`()` -> `Date`
    - `.meaning_correct()` -> `Integer` or `null`
    - `.meaning_incorrect()` -> `Integer` or `null`
    - `.meaning_max_streak()` -> `Integer` or `null`
    - `.meaning_current_streak()` -> `Integer` or `null`
    - `.reading_correct()` -> `Integer` or `null`
    - `.reading_incorrect()` -> `Integer` or `null`
    - `.reading_max_streak()` -> `Integer` or `null`
    - `.reading_current_streak()` -> `Integer` or `null`
- Radical
    - `.character()` -> `String`
    - `.meaning()` -> `String`
    - `.image()` -> `String` or `null`
    - `.level()` -> `Integer`
    - `.percentage()` -> `Integer` or `null`
- Kanji
    - `.character()` -> `String`
    - `.meaning()` -> `String`
    - `.onyomi()` -> `String`
    - `.kunyomi()` -> `String`
    - `.important_reading()` -> `String`
    - `.level()` -> `Integer`
    - `.percentage()` -> `Integer` or `null`
- Vocab
    - `.character()` -> `String`
    - `.kana()` -> `String`
    - `.meaning()` -> `String`
    - `.level()` -> `Integer`
    - `.percentage()` -> `Integer`

## User Interface
(assuming user is a User instance)

- `user.info` -> `UserInformation`
    - `.username()` -> `String`
    - `.gravatar()` -> `String`
    - `.level()` -> `Integer`
    - `.title()` -> `String`
    - `.about()` -> `String`
    - `.website()` -> `String` or `null`
    - `.twitter()` -> `String`
    - `.topics_count()` -> `Integer`
    - `.creation_date` -> `Date`
    - `.avatar_url(size=null)` -> `String`
    - `.profile_url()` -> `String`
    - `.twitter_url()` -> `String`,
    - `.image(size, css_class='', doc=window.document)` -> `HTMLImageElement`
    - `.weblink(text, css_class='', doc=window.document)` -> `HTMLAnchorElement`
    - `.data` -> `Object` (raw query data)
- `user.study_queue` -> `StudyQueue`
    - `.lessions_available()` -> `Integer`
    - `.reviews_available()` -> `Integer`
    - `.next_review_date()` -> `Date`
    - `.reviews_available_next_hour()` -> `Integer`
    - `.reviews_available_next_day()` -> `Integer`
    - `.data` -> Object // raw query data
- `user.level_progression` -> `Object`
    - `.radicals_progress()` -> `Integer`
    - `.radicals_total()` -> `Integer`
    - `.kanji_progress()` -> `Integer`
    - `.kanji_total()` -> `Integer`
    - `.data` -> `Object` // raw query data
- `user.srs_distribution` -> `Object` // Note that this is the raw data from the query
    - `.apprentice` -> `Object`
        - `.radicals` -> `Integer`
        - `.kanji` -> `Integer`
        - `.vocabulary` -> `Integer`
        - `.total` -> `Integer`
    - `.guru`, `.master`, `.enlighten`, `.burn`
        - // Same as `.apprentice`
- `user.recent_unlocks` -> `RecentUnlocksCollection`
    - `.getByTypeCharacter(type, character)` -> `Character` or `undefined`
        // Where type is 'radical', 'vocabulary' or 'kanji'
    - `.getByCharacter(character)` -> `Array[Character]`
    - `.toArray()` -> `Array[Character]`
        - // Note that you SHOULD NOT modify this array - it is a 
          reference to the internal data store.
          If you require a copy, use `.toArray().slice(0);`
- `user.critical_items` -> `CriticalItemsCollection`
    - Same as user.recent_unlocks
- `user.radicals` -> `RadicalCollection`
    - `.getByCharacter(character)` -> `Radical`
- `user.kanji` -> `KanjiCollection`
    - Same as `.radicals`, but returns Kanji types
- `user.vocabulary` -> `VocabCollection`
    - same as `.radicals`, but returns Vocab types

General documentation on the API can be found at
http://www.wanikani.com/api
If you want to access a value that is not wrapped, use object.data[key]
Note, however, it will not be cached (and so may not always be present)

All objects support JSON serialization - for example:
`user.wrapper.update(JSON.parse(JSON.generate(user.wrapper)))`
