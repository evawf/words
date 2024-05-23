require("dotenv").config();
const uuid = require("uuid");
const express = require("express");
var cors = require("cors");
const app = express();
const bodyParser = require("body-parser");
const port = 8888;

// create application/json parser
const jsonParser = bodyParser.json();

// create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// enable cors
app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL,
  })
);

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  res.header("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS");

  next();
});

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
    const getWords = await db.any(
      "SELECT * FROM words ORDER BY created_at DESC"
    );
    res.json({ words: getWords });
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
    const { newWord } = req.body;
    console.log("new word: ", newWord);

    //Check if word already added in db
    const checkIfNewWord = await db.any(
      "SELECT * FROM words WHERE word=$1",
      newWord
    );
    console.log("new word? ", !checkIfNewWord.length);

    if (!checkIfNewWord.length) {
      const id = uuid.v4();
      await db.none("INSERT INTO words(id, word) VALUES($1, $2)", [
        id,
        newWord,
      ]);

      res.json({ newWord: newWord, id: id, newWordAdded: true });
    } else {
      res.json({ isExistingWord: true });
    }
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.put("/word/:id/update", jsonParser, async (req, res) => {
  try {
    const { is_mastered } = req.body;
    const { id } = req.params;
    console.log("word: ", is_mastered, id);

    const getResult = await db.none(
      `UPDATE words SET is_mastered=$1 WHERE id=$2`,
      [is_mastered, id]
    );

    console.log(getResult);

    res.json({ msg: "word status updated" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.delete("/word/:id/delete", jsonParser, async (req, res) => {
  try {
    const { id } = req.params;
    await db.result("DELETE FROM words WHERE id=$1", id);

    res.json({ msg: "Word deleted successful!" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.listen(port, () => {
  console.log(`Words app is running on port ${port}`);
});
