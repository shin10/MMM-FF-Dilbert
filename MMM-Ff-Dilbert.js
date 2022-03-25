/* Magic Mirror
 * Module: MMM-Ff-Dilbert
 *
 * By Michael Trenkler
 * ISC Licensed.
 */

Module.register("MMM-Ff-Dilbert", {
  defaults: {
    header: "Dilbert",
    initialComic: "latest",
    sequence: "random",
    updateOnSuspension: null,
    updateInterval: 1 * 60 * 60 * 1000,
    grayscale: false,
    highContrast: false,
    inverted: false,
    imageMaxWidth: null,
    imageMaxHeight: null,
    showTitle: true,
    showDate: true,
    animationSpeed: 1000,
    events: {
      COMIC_FIRST: "COMIC_FIRST",
      COMIC_LATEST: "COMIC_LATEST",
      COMIC_PREVIOUS: "COMIC_PREVIOUS",
      COMIC_NEXT: "COMIC_NEXT",
      COMIC_RANDOM: "COMIC_RANDOM"
    },
    persistence: null,
    persistenceId: null,
    persistencePath: null
  },

  init: function () {
    this.error = null;
    this.comicData = {
      id: null,
      url: null,
      title: null,
      alt: null,
      img: null,
      previous: null,
      next: null
    };
  },

  start: function () {
    Log.info("Starting module: " + this.name);
    this.config.moduleId = this.identifier;
    if (this.config.persistenceId === null)
      this.config.persistenceId = this.config.moduleId;
    if (this.config.persistence) {
      this.readPersistentState();
    }
    this.sendSocketNotification("GET_INITIAL_COMIC", { config: this.config });
  },

  clientUsesStorage: function () {
    const config = this.config;
    return (
      config.persistence === "client" ||
      (config.persistence === "electron" &&
        window.navigator.userAgent.match(/Electron/i))
    );
  },

  getPersistenceStore: function () {
    const config = this.config;
    return [config.persistenceId, "data"].join("/").replace(/\/\//g, "/");
  },

  readPersistentState: function () {
    if (this.clientUsesStorage()) {
      const path = this.getPersistenceStore();
      const data = window.localStorage.getItem(path);
      if (data) {
        const json = JSON.parse(data);
        const pId = json.id;
        if (pId.match(/^\d{4,4}-\d{2,2}-\d{2,2}$/)) {
          this.config.initialComic = pId;
        }
      }
    }
  },

  writePersistentState: function () {
    const config = this.config;
    if (this.clientUsesStorage() && this.comicData?.id) {
      const path = this.getPersistenceStore(config);
      const data = JSON.stringify({ id: this.comicData.id });
      window.localStorage.setItem(path, data);
    }
  },

  getScripts: function () {
    return [];
  },

  getStyles: function () {
    return [this.file("./styles/MMM-Ff-Dilbert.css")];
  },

  getHeader: function () {
    if (!this.config.showTitle || !this.comicData) return null;
    const title = [];
    title.push(this.config.header);
    if (this.comicData.title && this.comicData.title !== "")
      title.push(this.comicData.title);
    if (this.config.showDate && this.comicData.id && this.comicData.id !== "")
      title.push(this.comicData.id);
    return title.join(" - ");
  },

  getDom: function () {
    const wrapper = document.createElement("div");

    if (this.error) {
      wrapper.innerHTML = "ERROR<br>" + JSON.stringify(this.error);
      wrapper.className = "light small error";
      return wrapper;
    }

    const loaded = this.comicData?.id;
    if (!loaded) {
      wrapper.innerHTML = "Loading...";
      wrapper.className = "light small dimmed";
      return wrapper;
    }

    const imgWrapper = document.createElement("div");
    imgWrapper.classList.add("comic-wrapper");

    const img = document.createElement("img");
    img.classList.add("comic");
    img.src = this.comicData.img;
    img.alt = this.comicData.alt;

    img.classList.toggle("grayscale", this.config.grayscale);
    img.classList.toggle("inverted", this.config.inverted);
    img.classList.toggle("high-contrast", this.config.highContrast);

    img.style.maxWidth = this.config.imageMaxWidth;
    img.style.maxHeight = this.config.imageMaxHeight;

    imgWrapper.appendChild(img);
    wrapper.appendChild(imgWrapper);

    return wrapper;
  },

  socketNotificationReceived: function (notification, payload) {
    if (payload.config?.moduleId !== this.config.moduleId) return;
    switch (notification) {
      case "ERROR":
        this.error = payload;
        this.updateDom(this.config.animationSpeed);
        break;
      case "UPDATE_COMIC":
        this.error = null;
        this.comicData = payload.config.comic;
        this.config.comic = this.comicData;
        this.updateDom(this.config.animationSpeed);
        this.writePersistentState();
        break;
      default:
        break;
    }
  },

  isAcceptableSender(sender) {
    if (!sender) return true;
    const acceptableSender = this.config.events.sender;
    return (
      !acceptableSender ||
      acceptableSender === sender.name ||
      acceptableSender === sender.identifier ||
      (Array.isArray(acceptableSender) &&
        (acceptableSender.includes(sender.name) ||
          acceptableSender.includes(sender.identifier)))
    );
  },

  notificationReceived: function (notification, payload, sender) {
    if (!this.isAcceptableSender(sender)) return;

    switch (notification) {
      case this.config.events.COMIC_FIRST:
        if (!this.hidden)
          this.sendSocketNotification("GET_FIRST_COMIC", {
            config: this.config
          });
        break;
      case this.config.events.COMIC_LATEST:
        if (!this.hidden)
          this.sendSocketNotification("GET_LATEST_COMIC", {
            config: this.config
          });
        break;
      case this.config.events.COMIC_PREVIOUS:
        if (!this.hidden)
          this.sendSocketNotification("GET_PREVIOUS_COMIC", {
            config: this.config
          });
        break;
      case this.config.events.COMIC_NEXT:
        if (!this.hidden)
          this.sendSocketNotification("GET_NEXT_COMIC", {
            config: this.config
          });
        break;
      case this.config.events.COMIC_RANDOM:
        if (!this.hidden)
          this.sendSocketNotification("GET_RANDOM_COMIC", {
            config: this.config
          });
        break;
      default:
        break;
    }
  },

  suspend: function () {
    this.suspended = true;
    this.sendSocketNotification("SUSPEND", { config: this.config });
  },

  resume: function () {
    if (this.suspended === false) return;
    this.suspended = false;
    this.sendSocketNotification("RESUME", { config: this.config });
  }
});
