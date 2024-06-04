require("dotenv").config();
const uuid = require("uuid");
const express = require("express");
var cors = require("cors");
const app = express();
const bodyParser = require("body-parser");
const port = 8888;
const session = require("express-session");
const authSession = require("./authMiddleware");
const bcrypt = require("bcryptjs");

const sessionName = process.env.SESSION_NAME;
const sessionSecret = process.env.SESSION_SECRET;
const sessionLifetime = Number(process.env.SESSION_LIFETIME);

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

// express session auth
app.set("trust proxy", process.env.NODE_ENV !== "production");
app.use(
  session({
    name: sessionName,
    secret: sessionSecret, // check
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: sessionLifetime,
      sameSite: "strict",
      httpOnly: true,
      secure: false,
    },
  })
);

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

// Routes - register new user
app.post("/register", async (req, res) => {
  const { display_name, email, password } = req.body;
  const id = uuid.v4();

  // Hash password
  const saltRounds = Number(process.env.SALT);
  const salt = bcrypt.genSaltSync(saltRounds);
  const hashedPassword = bcrypt.hashSync(password, salt);

  try {
    const getUser = await db.any(`SELECT * FROM users WHERE email='${email}'`);
    console.log("gerUser: ", getUser);
    const user = getUser;
    // Check if user account already exists
    if (user.length !== 0) {
      res
        .status(200)
        .send({ message: "User already exists, please head to login" });
    } else {
      await db.none(
        "INSERT INTO users (id, display_name, email, password) VALUES($1, $2, $3, $4)",
        [id, display_name, email, hashedPassword]
      );
      res.status(200).send({ message: "User account registered successfully" });
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// User log in
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const getUser = await db.any(`SELECT * FROM users WHERE email=$1`, email);
    const [user] = getUser;
    const hashedPassword = user.password;
    const isMatch = bcrypt.compareSync(password.toString(), hashedPassword); // true
    if (isMatch) {
      req.session.isAuthenticated = true;
      req.session.user = user;
      res.status(200).send({ message: "You have logged in" });
    } else {
      res
        .status(500)
        .send({ message: "Your password or your email is not correct" });
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// Protected routes as below:
app.use(authSession);

// User profile page
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;
  const userInfo = req.session.user;
  try {
    if (id === userInfo.id) {
      const getUser = await db.any(`SELECT * FROM users WHERE id=$1`, id);
      const user = getUser;
      res.status(200).send(user);
    } else {
      res.status(200).send({ message: "You are not authorized" });
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// Edit user profile info
app.put("/users/:id/edit", async (req, res) => {
  const { id } = req.params;
  const { display_name, password, first_name, last_name } = req.body;
  const userInfo = req.session.user;

  // Hash password
  const saltRounds = Number(process.env.SALT);
  const salt = bcrypt.genSaltSync(saltRounds);
  const hashedPassword = bcrypt.hashSync(password.toString(), salt);

  try {
    if (id === userInfo.id) {
      const updateUser = await db.none(
        `UPDATE users SET display_name=$1, password=$2, first_name=$3, last_name=$4 WHERE id=$5`,
        [display_name, hashedPassword, first_name, last_name, id]
      );
      console.log(updateUser);
      res.status(200).send({ message: "User updated" });
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// User log out
app.post("/logout", async (req, res) => {
  try {
    req.session.isAuthenticated = false;
    req.session.user = null;
    res.status(200).send({ message: "You've logged out" });
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// Get all words
app.get("/allwords", async (req, res) => {
  const userInfo = req.session.user;

  try {
    const getWords = await db.any(
      "SELECT * FROM words ORDER BY created_at DESC"
    );
    res.json({ words: getWords });
  } catch (err) {
    console.log("msg: ", err);
  }
});

// show words of the day
app.get("/words", async (req, res) => {
  try {
    const limit = 5;
    const getWords = await db.any(
      `SELECT * FROM words WHERE is_mastered=false ORDER BY random() LIMIT ($1)`,
      limit
    );

    //Get words of the day
    const getWordsOfTheDay = await db.any(
      `SELECT * FROM words WHERE (current_date - created_at::date) IN (0,1,2,4,7,15,30,90,180,240,365) AND is_mastered=false ORDER BY created_at DESC`
    );

    res.json({ words: getWordsOfTheDay });

    // res.send(`Welcome to words! Today's words: ${words}`);
  } catch (err) {
    console.log("msg: ", err);
  }
});

// add new word
app.post("/new", jsonParser, async (req, res) => {
  try {
    const { newWord, audio, definition } = req.body;
    const userInfo = req.session.user;

    //Check if word already added in db words table
    const checkIfNewWord = await db.any(
      "SELECT * FROM words WHERE word=$1",
      newWord
    );

    if (!checkIfNewWord.length) {
      const id = uuid.v4();
      await db.none(
        "INSERT INTO words(id, word, audio, definition) VALUES($1, $2, $3, $4)",
        [id, newWord, audio, definition]
      );

      // add it to user_word table
      const userWordId = uuid.v4();
      const userId = userInfo.id;
      await db.none(
        "INSERT INTO user_word(id, user_id, word_id) VALUES($1,$2,$3)",
        [userWordId, userId, id]
      );

      res.json({ msg: "It's a new word and you added to your table" });
    } else {
      const foundWord = checkIfNewWord[0];

      // check if current user already added to db user_word table
      const checkIfUserAlreadyAdded = await db.any(
        "SELECT * FROM user_word WHERE word_id=$1",
        foundWord.id
      );

      if (!checkIfUserAlreadyAdded.length) {
        const id = uuid.v4();
        const addNewWord = await db.none(
          "INSERT INTO user_word(id, user_id, word_id)",
          [id, userInfo.id, foundWord.id]
        );

        console.log("addNewWord: ", addNewWord);

        res.json({ msg: "You just added a new word" });
      } else {
        res.json({ msg: "You already added this word" });
      }
      // For existing word in words table but not added in user_word table
      const id = uuid.v4();
      const wordId = checkIfNewWord[0].id;
      await db.none("INSERT INTO user_word(id, user_id, word_id", [
        id,
        userInfo.id,
        wordId,
      ]);

      res.json({ msg: "Existing word, you just added to your list" });
    }
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.put("/word/:id/update", jsonParser, async (req, res) => {
  try {
    const { is_mastered } = req.body;
    const { id } = req.params;

    if (is_mastered) {
      const getResult = await db.none(
        `UPDATE words SET is_mastered=$1, updated_at=NOW(), mastered_at=NOW() WHERE id=$2`,
        [is_mastered, id]
      );
    } else {
      const getResult = await db.none(
        `UPDATE words SET is_mastered=$1, updated_at=NOW(), mastered_at=NULL WHERE id=$2`,
        [is_mastered, id]
      );
    }

    res.json({ msg: "word status updated" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.put("/word/:id/edit", jsonParser, async (req, res) => {
  try {
    const { word } = req.body;
    const { id } = req.params;
    const getResult = await db.none(
      `UPDATE words SET word=$1, updated_at=NOW() WHERE id=$2`,
      [word, id]
    );

    res.json({ msg: "word edited" });
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

app.get("/:word/definition", jsonParser, async (req, res) => {
  try {
    const { word } = req.params;
    const wordData = await db.one("SELECT * FROM words WHERE word=$1", word);

    if (!wordData.definition.length) return res.json({ msg: "failed" });
    if (wordData.definition !== null) {
      res.json({
        msg: "success",
        audio: wordData.audio,
        definition: [JSON.parse(...wordData.definition)],
      });
    } else {
      res.json({ msg: "failed" });
    }
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.put("/definition/update", jsonParser, async (req, res) => {
  try {
    const { audio, definition, word } = req.body;
    const getResult = await db.none(
      `UPDATE words SET audio=$1, definition=$2,q updated_at=NOW() WHERE word=$3`,
      [audio, definition, word]
    );
    console.log("result: ", getResult);
    res.json({ msg: "updated" });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.get("/word/data/:selectedMonth", jsonParser, async (req, res) => {
  try {
    const { selectedMonth } = req.params;
    const numOfMonth = Number(selectedMonth) - 1;
    const queryMonths = numOfMonth.toString() + " months";
    const queryNumOfWords = `SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)
                              FROM words
                              WHERE created_at::date >= DATE_TRUNC('month', now()) - interval $1
                              GROUP BY month
                              ORDER BY month ASC`;
    const getNumOfWords = await db.any(queryNumOfWords, queryMonths);

    const queryNumOfMastered = `SELECT DATE_TRUNC('month', mastered_at) AS month, COUNT(*)
                                FROM words
                                WHERE is_mastered=true 
                                AND mastered_at::date > DATE_TRUNC('month', now()) - interval $1
                                GROUP BY month
                                ORDER BY month ASC`;

    const getNumOfMastered = await db.any(queryNumOfMastered, queryMonths);

    function formatDate(timestamp) {
      const monthObj = {
        1: "Jan",
        2: "Feb",
        3: "Mar",
        4: "Apr",
        5: "May",
        6: "Jun",
        7: "Jul",
        8: "Aug",
        9: "Sep",
        10: "Oct",
        11: "Nov",
        12: "Dec",
      };
      const date = new Date(timestamp);
      const month = date.getMonth();
      return monthObj[month + 1] + " " + date.getFullYear();
    }

    const monthsArr = [];
    for (let i = numOfMonth; i >= 0; i--) {
      const d = new Date();
      let tempMonth = d.setFullYear(d.getFullYear(), d.getMonth() - i);
      monthsArr.push(formatDate(tempMonth));
    }

    const arrOfWords = Array(numOfMonth + 1).fill(0);
    getNumOfWords.forEach((t) => {
      if (monthsArr.includes(formatDate(t.month))) {
        arrOfWords[monthsArr.indexOf(formatDate(t.month))] = Number(t.count);
      }
    });

    const arrOfMastered = Array(numOfMonth + 1).fill(0);
    getNumOfMastered.forEach((m) => {
      if (monthsArr.includes(formatDate(m.month))) {
        arrOfMastered[monthsArr.indexOf(formatDate(m.month))] = Number(m.count);
      }
    });

    res.json({ msg: "data sent", monthsArr, arrOfWords, arrOfMastered });
  } catch (err) {
    console.log("msg: ", err);
  }
});

app.listen(port, () => {
  console.log(`Words app is running on port ${port}`);
});
