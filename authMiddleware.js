const authSession = (req, res, next) => {
  console.log("auth: ", req.session.isAuthenticated);
  if (req.session && req.session.isAuthenticated) return next();
  else return res.status(401).send("Unauthorized");
};

module.exports = authSession;
