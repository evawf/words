require("dotenv").config();
const express = require("express");
const app = express();
const port = 8888;

//************** Connect words DB **************//
const dbSetting = {
  userName: process.env.USER_NAME,
  userPassord: process.env.USER_PASSWORD,
  dbHost: process.env.DB_HOST,
  dbName: process.env.DB_NAME,
};
const pgp = require("pg-promise")();
const db = pgp(
  `postgres://${dbSetting.userName}:${dbSetting.userPassord}@${dbSetting.dbHost}/${dbSetting.dbName}`
);

app.get("/", async (req, res) => {
  try {
    const getWords = await db.any(
      "SELECT * FROM words ORDER BY random() LIMIT 3"
    );
    const words = getWords.map((w) => " " + w.word + " ");
    console.log("words: ", words);
    res.send(`Welcome to words! Today's words: ${words}`);
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.get("/new", async (req, res) => {
  try {
    res.send("Input words here: ");
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.listen(port, () => {
  console.log(`Words app is running on port ${port}`);
});
