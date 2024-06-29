require("dotenv").config();
const { defineWord } = require("wordreference");
const uuid = require("uuid");
const express = require("express");
var cors = require("cors");
const app = express();
const bodyParser = require("body-parser");
const port = process.env.PORT;
const session = require("express-session");
const authSession = require("./authMiddleware");
const bcrypt = require("bcryptjs");
const axios = require("axios");

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
    // origin: "capacitor://localhost",
    origin: process.env.FRONTEND_URL,
  })
);

app.use(function (req, res, next) {
  // res.header("Access-Control-Allow-Origin", "capacitor://localhost");
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
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
      expires: false,
      maxAge: sessionLifetime,
      sameSite: process.env.COOKIE_SAMESITE,
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
    },
  })
);

//************** Connect DB **************//
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
    const getUser = await db.any(`SELECT * FROM users WHERE email=$1`, email);
    const [user] = getUser;
    if (!user) {
      res.send({ msg: "Your password or email is not correct" });
    } else {
      const hashedPassword = user.password;
      const isMatch = bcrypt.compareSync(password.toString(), hashedPassword); // true
      if (isMatch) {
        req.session.isAuthenticated = true;
        req.session.user = user;
        res.status(200).send({
          msg: "You have logged in",
          userName: user.display_name,
          userId: user.id,
        });
      } else {
        res.send({ msg: "Your password or email is not correct" });
      }
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// Google OAuth
app.post("/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    const getUserInfo = await axios.get(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${token}`
    );

    const { email, name, given_name, family_name, id } = getUserInfo.data;

    const getUser = await db.any(`SELECT * FROM users WHERE email='${email}'`);
    const [user] = getUser;

    // check if existing user
    if (getUser.length !== 0) {
      req.session.isAuthenticated = true;
      req.session.user = user;
      res.status(200).send({
        msg: "You have logged in",
        userName: user.display_name,
        userId: user.id,
      });
    } else {
      const userId = uuid.v4();
      const addNewUser = await db.none(
        "INSERT INTO users (id, display_name, email, first_name, last_name, password) VALUES($1, $2, $3, $4, $5, $6)",
        [userId, name, email, given_name, family_name, id]
      );
      req.session.isAuthenticated = true;
      req.session.user = {
        id: userId,
        email: email,
        password: id,
        is_active: true,
        first_name: given_name,
        last_name: family_name,
      };

      res.status(200).send({
        message: "User account registered successfully",
        userName: name,
        userId: userId,
      });
    }
  } catch (err) {
    console.log("msg: ", err);
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
        isActive: getUser[0].is_active,
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
  const userInfo = req.session.user;
  const { displayName, password, firstName, lastName, email } = req.body;

  let hashedPassword = "";

  // Hash password
  if (password !== undefined) {
    const saltRounds = Number(process.env.SALT);
    const salt = bcrypt.genSaltSync(saltRounds);
    hashedPassword = bcrypt.hashSync(password.toString(), salt);
  }

  try {
    // if email is changed:
    if (email !== userInfo.email) {
      const isEmailAvailable = await db.any(
        `SELECT id FROM users WHERE email=$1`,
        email
      );
      if (isEmailAvailable.length !== 0) {
        res.send({ msg: "email is not available" });
      } else {
        await db.none("UPDATE users SET email=$1", email);
        res.send({ msg: "User Updated" });
      }
    } else {
      if (id === userInfo.id) {
        if (hashedPassword !== userInfo.password && password !== undefined) {
          const updateUser = await db.none(
            `UPDATE users SET display_name=$1, password=$2, first_name=$3, last_name=$4, updated_at=NOW() WHERE id=$5`,
            [displayName, hashedPassword, firstName, lastName, id]
          );
          res.status(200).send({ msg: "User updated" });
        } else {
          const updateUser = await db.none(
            `UPDATE users SET display_name=$1, password=$2, first_name=$3, last_name=$4, updated_at=NOW() WHERE id=$5`,
            [displayName, userInfo.password, firstName, lastName, id]
          );
          res.status(200).send({ msg: "User updated" });
        }
      }
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// delete user => set user as inactive
app.put("/users/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const deActiveUser = await db.none(
      `UPDATE users SET is_active=$1 WHERE id=$2`,
      [is_active, id]
    );

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

// Get all words added by current user
app.get("/allwords", async (req, res) => {
  const userInfo = req.session.user;
  try {
    if (req.session.isAuthenticated && userInfo) {
      const getWords = await db.any(
        `SELECT *, (SELECT is_mastered FROM user_word WHERE user_word.word_id=words.id AND user_word.user_id=$1) 
        FROM words WHERE id IN(SELECT word_id FROM user_word WHERE user_id=$1) 
        ORDER BY (SELECT created_at FROM user_word WHERE user_word.word_id = words.id AND user_word.user_id=$1) DESC`,
        userInfo.id
      );

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
      `SELECT * FROM words WHERE id IN (SELECT word_id FROM user_word WHERE (current_date - created_at::date) IN (0,1,2,4,7,15,30,90,180,240,365) AND is_mastered=false AND user_id=$1)
      ORDER BY (SELECT user_word.created_at FROM user_word WHERE user_word.word_id=words.id AND user_id=$1) DESC`,
      userInfo.id
    );

    res.json({ words: getWordsOfTheDay });
  } catch (err) {
    console.log("msg: ", err);
  }
});

// add new word
app.post("/new", jsonParser, async (req, res) => {
  try {
    const { newWord } = req.body;

    const userInfo = req.session.user;

    //Check if word already added in db words table
    const checkIfNewWord = await db.any(
      "SELECT * FROM words WHERE word=$1",
      newWord
    );

    if (!checkIfNewWord.length) {
      // get definition from wordreference
      const getDefinition = await defineWord(newWord, "French-English");
      console.log("getDefinition: ", getDefinition);
      const audio = getDefinition.audioLinks[0];
      const definition = getDefinition.sections;

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
        "SELECT * FROM user_word WHERE word_id=$1 AND user_id=$2",
        [foundWord.id, userInfo.id]
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
    const userInfo = req.session.user;

    // 1. check if updated word exists in word table
    const checkIfNewWord = await db.any(
      "SELECT * FROM words WHERE word=$1",
      word
    );
    if (!checkIfNewWord.length) {
      // 2. if not, creat word in word table, get audio and definition
      // get definition from wordreference
      const getDefinition = await defineWord(word, "French-English");
      const audio = getDefinition.audioLinks[0];
      const definition = getDefinition.sections;

      // add new word to word table
      const wordId = uuid.v4();
      await db.none(
        "INSERT INTO words(id, word, audio, definition) VALUES($1, $2, $3, $4)",
        [wordId, word, audio, definition]
      );

      // 3. update user_word table with new word id
      await db.none(
        "UPDATE user_word SET word_id=$1 WHERE word_id=$2 AND user_id=$3",
        [wordId, id, userInfo.id]
      );

      res.json({ msg: "word edited" });
    } else {
      // 4. if yes, then get word id
      const foundWord = checkIfNewWord[0];
      // 5. update user_word table with new word info - id
      await db.none(
        "UPDATE user_word SET word_id=$1 WHERE word_id=$2 AND user_id=$3",
        [foundWord.id, id, userInfo.id]
      );

      res.json({ msg: "word edited" });
    }
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
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
    res.sendStatus(500);
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
    res.sendStatus(500);
  }
});

app.put("/definition/update", jsonParser, async (req, res) => {
  try {
    const { audio, definition, word } = req.body;
    const getResult = await db.none(
      `UPDATE words SET audio=$1, definition=$2,q updated_at=NOW() WHERE word=$3`,
      [audio, definition, word]
    );
    res.json({ msg: "updated" });
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
  }
});

app.get("/word/data/:selectedMonth", jsonParser, async (req, res) => {
  try {
    const userInfo = req.session.user;
    const { selectedMonth } = req.params;
    const numOfMonth = Number(selectedMonth) - 1;
    const queryMonths = numOfMonth.toString() + " months";
    const queryNumOfWords = `SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)
                              FROM user_word
                              WHERE user_id=$1 AND created_at::date >= DATE_TRUNC('month', now()) - interval $2
                              GROUP BY month
                              ORDER BY month ASC`;
    const getNumOfWords = await db.any(queryNumOfWords, [
      userInfo.id,
      queryMonths,
    ]);

    const queryNumOfMastered = `SELECT DATE_TRUNC('month', mastered_at) AS month, COUNT(*)
                                FROM user_word
                                WHERE user_id=$1 AND is_mastered=true 
                                AND mastered_at::date > DATE_TRUNC('month', now()) - interval $2
                                GROUP BY month
                                ORDER BY month ASC`;

    const getNumOfMastered = await db.any(queryNumOfMastered, [
      userInfo.id,
      queryMonths,
    ]);

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
    res.sendStatus(500);
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const userInfo = req.session.user;
    const getWordsData = await db.any(`SELECT (COUNT *)`);
  } catch (err) {
    console.log("msg: ", err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Words app is running on port ${port}`);
});
