/* Magic Mirror
 * Module: MMM-FF-Dilbert
 *
 * By Michael Trenkler
 * ISC Licensed.
 */

const fs = require("fs");
const https = require("https");

const BASE_URL = "https://dilbert.com";
const FIRST_COMIC_ID = "1989-04-16";
const FIRST_COMIC_DATE = new Date(FIRST_COMIC_ID + " 00:00:00Z");
const FIRST_COMIC_VALUE = FIRST_COMIC_DATE.valueOf();

const ComicFetcher = function (nodeHelper, config) {
  var {
    moduleId,
    initialComic,
    sequence,
    updateOnSuspension,
    updateInterval,
    persistence,
    persistenceId,
    persistencePath
  } = config;

  // public for filtering
  this.moduleId = moduleId;

  var comic = null;
  var hidden = false;
  var timerObj = null;
  var updateOnVisibilityChangeRequested = false;

  const startInterval = () => {
    stopInterval();

    updateOnVisibilityChangeRequested = false;

    if (updateInterval === null) return;
    timerObj = setTimeout(() => intervalCallback(), updateInterval);
  };

  const stopInterval = () => {
    if (!timerObj) return;
    if (timerObj) clearTimeout(timerObj);
    timerObj = null;
  };

  const intervalCallback = () => {
    stopInterval();
    if (!hidden && updateOnSuspension !== true) {
      proceed();
    } else if (hidden && updateOnSuspension === null) {
      proceed();
    } else {
      updateOnVisibilityChangeRequested = true;
    }
  };

  const proceed = () => {
    stopInterval();

    if (!comic?.id) return;

    switch (sequence) {
      case "random":
        this.getRandomComic();
        break;
      case "reverse":
        this.getPreviousComic();
        break;
      case "latest":
        this.getLatestComic();
        break;
      default:
      case "default":
        this.getNextComic();
        break;
    }
  };

  this.getFirstComic = () => {
    this.getComic(urlById(FIRST_COMIC_ID));
  };

  this.getPreviousComic = () => {
    if (comic.previous) {
      this.getComic(BASE_URL + comic.previous);
    } else {
      this.getLatestComic();
    }
  };

  this.getNextComic = () => {
    if (comic.next) {
      this.getComic(BASE_URL + comic.next);
    } else {
      this.getFirstComic();
    }
  };

  this.suspend = () => {
    hidden = true;
    if (!comic) return;
    if (updateOnVisibilityChangeRequested && updateOnSuspension === true) {
      proceed();
    } else if (!timerObj && updateOnSuspension !== true) {
      startInterval();
    }
  };

  this.resume = () => {
    hidden = false;

    if (!comic) return;
    if (updateOnVisibilityChangeRequested && updateOnSuspension === false) {
      proceed();
    } else if (!timerObj) {
      startInterval();
    }
  };

  const dateToId = (date) => {
    return date.toISOString().substring(0, 10);
  };

  this.getInitialComic = () => {
    createPersistenceStorageDirectory();

    if (comic) {
      if (comic?.id) updateComic(comic);
      return;
    }

    if (persistence === "server") {
      const data = readPersistentState();
      if (data) {
        const pId = data.id;
        if (pId?.match(/^\d{4,4}-\d{2,2}-\d{2,2}$/)) initialComic = pId;
      }
    }

    comic = {};
    if (initialComic?.match(/^\d{4,4}-\d{2,2}-\d{2,2}$/)) {
      const url = urlById(initialComic);
      this.getComic(url);
    } else {
      switch (initialComic) {
        case "first":
          this.getFirstComic();
          break;
        case "random":
          this.getRandomComic();
          break;
        case "latest":
          this.getLatestComic();
          break;
        default:
          break;
      }
    }
  };

  const prepareNotificationConfig = () => {
    const copy = Object.assign({ comic: comic }, config);
    return copy;
  };

  const updateComic = (comicData) => {
    comic = comicData;
    nodeHelper.sendSocketNotification("UPDATE_COMIC", {
      config: prepareNotificationConfig()
    });
    writePersistentState({ id: comic.id });
    startInterval();
  };

  const getPersistenceStoragePath = () => {
    return [persistencePath, persistenceId]
      .join("/")
      .replace(/\/\//g, "/")
      .replace(/\/$/, "");
  };

  const createPersistenceStorageDirectory = () => {
    if (persistencePath === null) {
      persistencePath = `${nodeHelper.path}/.store`;
    }
    if (persistence === "server") {
      const path = getPersistenceStoragePath();
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true });
      }
      if (!fs.lstatSync(path).isDirectory()) {
        persistence = false;
      }
    }
  };

  const readPersistentState = () => {
    if (persistence === "server") {
      const path = getPersistenceStoragePath();
      const filePath = path + "/data";
      if (!fs.existsSync(filePath)) return null;
      const buffer = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" });
      const json = JSON.parse(buffer);
      return json;
    }
    return null;
  };

  const writePersistentState = (data) => {
    if (persistence === "server") {
      const path = getPersistenceStoragePath();
      const filePath = path + "/data";
      fs.writeFileSync(filePath, JSON.stringify(data), {
        encoding: "utf8",
        flag: "w"
      });
    }
  };

  this.getLatestComic = () => {
    this.getComic(BASE_URL);
  };

  this.getRandomComic = () => {
    const maxDate = new Date();
    const date = new Date(
      FIRST_COMIC_VALUE +
        Math.random() * (maxDate.valueOf() - FIRST_COMIC_VALUE)
    );
    this.getComic(urlById(dateToId(date)));
  };

  const urlById = (id) => {
    return BASE_URL + "/strip/" + id;
  };

  const parseData = (body) => {
    // the following ugly hack is to avoid dependencies for a DOM lib
    const comic = {
      id: body.match(/comic-item-container.*? data-id="(.*?)"/s)?.[1],
      url: body.match(/comic-item-container.*? data-url="(.*?)"/s)?.[1],
      title: body.match(/comic-title-name.*?>(.*?)<"/s)?.[1] || "",
      img: body.match(/img-comic.*? src="(.*?)"/s)?.[1],
      alt: body.match(/img-comic.*? alt="(.*?)"/s)?.[1],
      previous:
        body.match(/js-load-comic-older.*? href="(.*?)"/s)?.[1] ||
        body.match(
          /comic-item-container.*?comic-item-container.*? data-url="(.*?)"/s
        )?.[1],
      next: body.match(/js-load-comic-newer.*? href="(.*?)"/s)?.[1]
    };
    return comic;
  };

  this.getComic = (url) => {
    stopInterval();

    const request = https
      .get(url, (response) => {
        if (response.statusCode === 200) {
          let data = "";
          response
            .on("data", (body) => {
              data += body;
            })
            .on("end", () => {
              updateComic(parseData(data));
            })
            .on("error", (err) => {
              nodeHelper.sendSocketNotification("ERROR", err);
            });
        } else {
          nodeHelper.sendSocketNotification("ERROR", response);
        }
      })
      .on("error", (err) => {
        nodeHelper.sendSocketNotification("ERROR", err);
      });

    request.end();
  };
};

module.exports = ComicFetcher;
