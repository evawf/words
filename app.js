require("dotenv").config();
const uuid = require("uuid");
const express = require("express");
var cors = require("cors");
const app = express();
const bodyParser = require("body-parser");
const port = process.env.PORT;
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
  res.header("Access-Control-Allow-Origin", process.env.FRONTEND_URL);
  res.header("Access-Control-Allow-Credentials", true);
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "POST, PUT, GET, DELETE");

  next();
});

// express session auth
app.set("trust proxy", process.env.NODE_ENV !== "production");
app.use(
  session({
    name: sessionName,
    secret: sessionSecret, // check
    resave: true,
    saveUninitialized: true,
    cookie: {
      maxAge: sessionLifetime,
      sameSite: process.env.COOKIE_SAMESITE,
      httpOnly: true,
      secure: process.env.COOKE_SECURE,
      // domain: "localhost",
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
    const [user] = getUser;
    // Check if user account already exists
    if (getUser.length !== 0) {
      res
        .status(200)
        .send({ message: "User already exists, please head to login" });
    } else {
      const addNewUser = await db.none(
        "INSERT INTO users (id, display_name, email, password) VALUES($1, $2, $3, $4)",
        [id, display_name, email, hashedPassword]
      );

      res.status(200).send({
        message: "User account registered successfully",
      });
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
    const getUser = await db.any(
      `SELECT * FROM users WHERE email=$1 AND is_active=$2`,
      [email, true]
    );
    const [user] = getUser;
    const hashedPassword = user.password;
    const isMatch = bcrypt.compareSync(password.toString(), hashedPassword); // true
    if (isMatch) {
      req.session.isAuthenticated = true;
      req.session.user = user;
      res.status(200).send({
        message: "You have logged in",
        userName: user.display_name,
        userId: user.id,
      });
    } else {
      res
        .status(500)
        .send({ message: "Your password or email is not correct" });
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
      const user = {
        displayName: getUser[0].display_name,
        firstName: getUser[0].first_name,
        lastName: getUser[0].last_name,
        email: getUser[0].email,
      };

      res.status(200).send({ user });
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
      res.status(200).send({ message: "User updated" });
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// delete user => set user as inactive
app.put("/users/:id/deactivate", async (req, res) => {
  try {
    const { id } = req.params;
    const deActiveUser = await db.none(
      `UPDATE users SET is_active=$1 WHERE id=$2`,
      [false, id]
    );
    console.log(deActiveUser);

    res.status(200).send({ msg: "user deactivated" });
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// admin route - view info
app.get("/users", async (req, res) => {
  try {
    const user = req.session.user;
    const userEmail = user.email;
    if (userEmail === process.env.ADMIN) {
      const data = await db.any("SELECT * FROM users");
      res.status(200).send(data);
    } else {
      res.status(200).send({ message: "You are not authorized" });
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

// Get all words add by current user
app.get("/allwords", async (req, res) => {
  console.log(req.session);
  const user = req.session.user;
  console.log("user: ", user);
  try {
    if (req.session && user) {
      const getWords = await db.any(
        `SELECT *, (SELECT is_mastered FROM user_word WHERE words.id=user_word.word_id) FROM words WHERE id IN(SELECT word_id FROM user_word WHERE user_id=$1) ORDER BY (SELECT created_at FROM user_word where user_word.word_id = words.id) DESC`,
        user.id
      );
      console.log(getWords);
      res.json({ words: getWords });
    } else {
      res.redirect("/login");
    }
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
  }
});

// show words of the day
app.get("/words", async (req, res) => {
  const userInfo = req.session.user;
  try {
    //Get words of the day
    const getWordsOfTheDay = await db.any(
      `SELECT * FROM words WHERE id IN (SELECT word_id FROM user_word WHERE (current_date - created_at::date) IN (0,1,2,4,7,15,30,90,180,240,365) AND is_mastered=false AND user_id=$1 ORDER BY created_at DESC)`,
      userInfo.id
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
      // add new word to word table
      const wordId = uuid.v4();
      await db.none(
        "INSERT INTO words(id, word, audio, definition) VALUES($1, $2, $3, $4)",
        [wordId, newWord, audio, definition]
      );

      // add it to user_word table
      const userWordId = uuid.v4();
      const userId = userInfo.id;
      await db.none(
        "INSERT INTO user_word(id, user_id, word_id) VALUES($1, $2, $3)",
        [userWordId, userId, wordId]
      );

      res.json({
        msg: "word added",
        id: wordId,
      });
    } else {
      // check if current user already added to db user_word table
      const foundWord = checkIfNewWord[0];
      const checkIfUserAlreadyAdded = await db.any(
        "SELECT * FROM user_word WHERE word_id=$1",
        foundWord.id
      );

      if (!checkIfUserAlreadyAdded.length) {
        // add word to user_word table
        const userWordId = uuid.v4();
        const addNewWord = await db.none(
          "INSERT INTO user_word(id, user_id, word_id) VALUES($1, $2, $3)",
          [userWordId, userInfo.id, foundWord.id]
        );

        res.json({ msg: "word added", id: foundWord.id });
      } else {
        // word already added to user_word table
        res.json({ msg: "You already added this word", isExistingWord: true });
      }
    }
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
  }
});

// toggle is_mastered status
app.put("/word/:id/update", jsonParser, async (req, res) => {
  try {
    const { is_mastered } = req.body;
    const { id } = req.params;
    const user = req.session.user;
    console.log(is_mastered, id, user.id);
    if (is_mastered) {
      const getResult = await db.none(
        `UPDATE user_word SET is_mastered=$1, updated_at=NOW(), mastered_at=NOW() WHERE word_id=$2 AND user_id=$3`,
        [is_mastered, id, user.id]
      );
    } else {
      const getResult = await db.none(
        `UPDATE user_word SET is_mastered=$1, updated_at=NOW(), mastered_at=NULL WHERE word_id=$2 AND user_id=$3`,
        [is_mastered, id, user.id]
      );
      console.log(getResult);
    }

    res.json({ msg: "word status updated" });
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
  }
});

// edit word in words table
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
    const user = req.session.user;
    await db.result("DELETE FROM user_word WHERE word_id=$1 AND user_id=$2", [
      id,
      user.id,
    ]);

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
                              FROM user_word
                              WHERE created_at::date >= DATE_TRUNC('month', now()) - interval $1
                              GROUP BY month
                              ORDER BY month ASC`;
    const getNumOfWords = await db.any(queryNumOfWords, queryMonths);

    const queryNumOfMastered = `SELECT DATE_TRUNC('month', mastered_at) AS month, COUNT(*)
                                FROM user_word
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
