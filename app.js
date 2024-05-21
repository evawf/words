require("dotenv").config();
const express = require("express");
const app = express();
const bodyParser = require("body-parser");

// create application/json parser
const jsonParser = bodyParser.json();

// create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false });

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

app.get("/allwords", async (req, res) => {
  try {
    const getWords = await db.any("SELECT * FROM words");
    const words = getWords.map((w) => w.word);
    res.json({ words: words });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.get("/words", async (req, res) => {
  try {
    const getWords = await db.any(
      "SELECT * FROM words ORDER BY random() LIMIT 3"
    );
    const words = getWords.map((w) => w.word);
    res.json({ words: words });
    // res.send(`Welcome to words! Today's words: ${words}`);
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.post("/new", jsonParser, async (req, res) => {
  try {
    const { newWords } = req.body;
    newWords.forEach(async (w) => {
      await db.none("INSERT INTO words(word) VALUES(${word})", {
        word: `${w}`,
      });
    });

    res.json({ newWords: newWords, msg: "new words added!" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.delete("/delete", jsonParser, async (req, res) => {
  try {
    const { wordToDelete } = req.body;
    console.log("word to delete: ", wordToDelete);
    await db.result("DELETE FROM words WHERE word=$1", wordToDelete);

    res.json({ msg: "Word deleted successful!" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.listen(port, () => {
  console.log(`Words app is running on port ${port}`);
});
