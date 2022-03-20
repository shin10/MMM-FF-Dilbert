/* Magic Mirror
 * Module: MMM-Ff-Dilbert
 *
 * By Michael Trenkler
 * ISC Licensed.
 */

// const fetch = require("node-fetch");
const NodeHelper = require("node_helper");
const fs = require("fs");
const https = require("https");

const BASE_URL = "https://dilbert.com";
const FIRST_COMIC_ID = "1989-04-16";
const FIRST_COMIC_DATE = new Date(FIRST_COMIC_ID + " 00:00:00Z");
const FIRST_COMIC_VALUE = FIRST_COMIC_DATE.valueOf();

module.exports = NodeHelper.create({
  /**
   * A pool of instance configs with references to their individual
   * timerObjects and comic data.
   */
  instanceData: {},

  start: function () {
    console.log("Starting node helper: " + this.name);
  },

  stopInterval(config) {
    const timerObj = this.instanceData[config.moduleId]?.timerObj;
    if (!timerObj) return;
    if (timerObj) clearTimeout(timerObj);
    this.instanceData[config.moduleId].timerObj = null;
  },

  startInterval: function (config) {
    this.stopInterval(config);

    config.updateOnVisibilityChangeRequested = false;
    if (!this.instanceData[config.moduleId])
      this.instanceData[config.moduleId] = config;
    const instanceConfig = this.instanceData[config.moduleId];

    if (config.updateInterval === null) return;
    instanceConfig.timerObj = setTimeout(
      () => this.intervalCallback(instanceConfig),
      config.updateInterval,
      config
    );
  },

  intervalCallback: function (config) {
    this.stopInterval(config);
    if (!config.hidden && config.updateOnSuspension !== true) {
      this.proceed(config);
    } else if (config.hidden && config.updateOnSuspension === null) {
      this.proceed(config);
    } else {
      config.updateOnVisibilityChangeRequested = true;
    }
  },

  proceed: function (config) {
    this.stopInterval(config);

    if (!config.comic?.id) return;

    switch (config.sequence) {
      case "random":
        this.getRandomComic(config);
        break;
      case "reverse":
        this.getPreviousComic(config);
        break;
      case "latest":
        this.getLatestComic(config);
        break;
      default:
      case "default":
        this.getNextComic(config);
        break;
    }
  },

  getFirstComic: function (config) {
    this.getComic(config, this.urlById(FIRST_COMIC_ID));
  },

  getPreviousComic: function (config) {
    if (config.comic.previous) {
      this.getComic(config, BASE_URL + config.comic.previous);
    } else {
      this.getLatestComic(config);
    }
  },

  getNextComic: function (config) {
    if (config.comic.next) {
      this.getComic(config, BASE_URL + config.comic.next);
    } else {
      this.getFirstComic(config);
    }
  },

  prepareNotificationConfig: function (config) {
    /**
     * Returns a clone of the config and without it's timerObj to avoid circular reference
     * errors when serializing the config.
     */
    const copy = Object.assign({}, config);
    delete copy.timerObj;
    return copy;
  },

  socketNotificationReceived: function (notification, payload) {
    const instanceConfig =
      this.instanceData[payload.config.moduleId] || payload.config;

    switch (notification) {
      case "GET_INITIAL_COMIC":
        this.createPersistenceStorageDirectory(instanceConfig);
        this.getInitialComic(instanceConfig);
        break;
      case "GET_FIRST_COMIC":
        this.getFirstComic(instanceConfig);
        break;
      case "GET_PREVIOUS_COMIC":
        this.getPreviousComic(instanceConfig);
        break;
      case "GET_NEXT_COMIC":
        this.getNextComic(instanceConfig);
        break;
      case "GET_LATEST_COMIC":
        this.getLatestComic(instanceConfig);
        break;
      case "GET_RANDOM_COMIC":
        this.getRandomComic(instanceConfig);
        break;
      case "GET_COMIC":
        this.getComic(instanceConfig, payload.url);
        break;
      case "SUSPEND":
        instanceConfig.hidden = true;
        if (!instanceConfig.comic) return;
        if (
          instanceConfig.updateOnVisibilityChangeRequested &&
          instanceConfig.updateOnSuspension === true
        ) {
          this.proceed(instanceConfig);
        } else if (
          !instanceConfig.timerObj &&
          instanceConfig.updateOnSuspension !== true
        ) {
          this.startInterval(instanceConfig);
        }
        break;
      case "RESUME":
        instanceConfig.hidden = false;

        if (!instanceConfig.comic) return;
        if (
          instanceConfig.updateOnVisibilityChangeRequested &&
          instanceConfig.updateOnSuspension === false
        ) {
          this.proceed(instanceConfig);
        } else if (!instanceConfig.timerObj) {
          this.startInterval(instanceConfig);
        }
        break;
      default:
        break;
    }
  },

  dateToId: function (date) {
    return date.toISOString().substring(0, 10);
  },

  getInitialComic: function (config) {
    let instanceConfig = this.instanceData[config.moduleId];

    if (!instanceConfig) {
      instanceConfig = this.instanceData[config.moduleId] = config;
    }

    if (instanceConfig.comic?.id) {
      this.updateComic(instanceConfig, instanceConfig.comic);
      return;
    }

    if (instanceConfig.comic) return;

    let initialComic = config.initialComic;

    if (config.persistence === "server") {
      const data = this.readPersistentState(config);
      if (data) {
        const pId = data.id;
        if (pId?.match(/^\d{4,4}-\d{2,2}-\d{2,2}$/)) initialComic = pId;
      }
    }

    this.instanceData[config.moduleId].comic = {};
    if (initialComic?.match(/^\d{4,4}-\d{2,2}-\d{2,2}$/)) {
      const url = this.urlById(initialComic);
      this.getComic(config, url);
    } else {
      switch (initialComic) {
        case "first":
          this.getFirstComic(config);
          break;
        case "random":
          this.getRandomComic(config);
          break;
        case "latest":
          this.getLatestComic(config);
          break;
        default:
          break;
      }
    }
  },

  updateComic: function (config, comic) {
    config.comic = comic;
    const instanceConfig = (this.instanceData[config.moduleId] = config);
    this.sendSocketNotification("UPDATE_COMIC", {
      config: this.prepareNotificationConfig(instanceConfig)
    });
    this.writePersistentState(config, { id: comic.id });
    this.startInterval(config);
  },

  getPersistenceStoragePath: function (config) {
    return [config.persistencePath, config.persistenceId]
      .join("/")
      .replace(/\/\//g, "/")
      .replace(/\/$/, "");
  },

  createPersistenceStorageDirectory: function (config) {
    if (config.persistencePath === null) {
      config.persistencePath = `${this.path}/.store`;
    }
    if (config.persistence === "server") {
      const path = this.getPersistenceStoragePath(config);
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true });
      }
      if (!fs.lstatSync(path).isDirectory()) {
        config.persistence = false;
      }
    }
  },

  readPersistentState: function (config) {
    if (config.persistence === "server") {
      const path = this.getPersistenceStoragePath(config);
      const filePath = path + "/data";
      if (!fs.existsSync(filePath)) return null;
      const buffer = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" });
      const json = JSON.parse(buffer);
      return json;
    }
    return null;
  },

  writePersistentState: function (config, data) {
    if (config.persistence === "server") {
      const path = this.getPersistenceStoragePath(config);
      const filePath = path + "/data";
      fs.writeFileSync(filePath, JSON.stringify(data), {
        encoding: "utf8",
        flag: "w"
      });
    }
  },

  getLatestComic: function (config) {
    this.getComic(config, BASE_URL);
  },

  getRandomComic: function (config) {
    const maxDate = new Date();
    const date = new Date(
      FIRST_COMIC_VALUE +
        Math.random() * (maxDate.valueOf() - FIRST_COMIC_VALUE)
    );
    this.getComic(config, this.urlById(this.dateToId(date)));
  },

  urlById: function (id) {
    return BASE_URL + "/strip/" + id;
  },

  parseData: function (body) {
    // the following ugly hack is to avoid dependencies for a DOM lib

    // const $ = cheerio.load(body);
    // const comic = {
    //   id: $(".comic-item-container").attr("data-id"),
    //   url: $(".comic-item-container").attr("data-url"),
    //   title: $(".comic-title-name").text(),
    //   img: $(".img-comic").attr("src"),
    //   alt: $(".img-comic").attr("alt"),
    //   previous:
    //     $(".js-load-comic-older").attr("href") ||
    //     $(".comic-item-container")[2]?.attr("data-url"),
    //   next: $(".js-load-comic-newer").attr("href")
    // };

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
  },

  getComic: function (config, url) {
    this.stopInterval(config);

    const request = https
      .get(url, (response) => {
        if (response.statusCode === 200) {
          let data = "";
          response
            .on("data", (body) => {
              data += body;
            })
            .on("end", () => {
              this.updateComic(config, this.parseData(data));
            })
            .on("error", (err) => {
              console.error(err);
              this.sendSocketNotification("ERROR", err);
            });
        } else {
          this.sendSocketNotification("ERROR", response);
        }
      })
      .on("error", (err) => {
        console.error(err);
        this.sendSocketNotification("ERROR", err);
      });

    request.end();
  }
});
