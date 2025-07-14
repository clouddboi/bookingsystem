const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const moment = require('moment');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

app.use(session({
  secret: 'mySuperSecretKey123!@#',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connected');
})
.catch(err => {
  console.log('MongoDB connection error:', err);
});

// Define schemas
const courtSchema = new mongoose.Schema({
  name: String,
  sport: String,
  price: Number,
  status: String
});

const bookingSchema = new mongoose.Schema({
  court_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Court' },
  date: String,
  start_time: String,
  end_time: String,
  duration: Number,
  customer_name: String,
  email: String,
  phone: String
});

const Court = mongoose.model('Court', courtSchema);
const Booking = mongoose.model('Booking', bookingSchema);

app.get('/', (req, res) => {
  res.render('home');
});

app.get('/staff-login', (req, res) => {
  res.render('staff-login', { error: null });
});

app.post('/staff-login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const users = {
    Staff1: 'admin',
    Staff2: 'owner'
  };

  if (users[username] && users[username] === password) {
    req.session.user = { username: username };
    res.redirect('/staff/dashboard');
  } else {
    res.render('staff-login', { error: 'Invalid username or password' });
  }
});

app.get('/staff/dashboard', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/staff-login');
  }

  const username = req.session.user.username;
  const todayDate = moment().format('YYYY-MM-DD');
  const weekStart = moment().startOf('isoWeek').format('YYYY-MM-DD');
  const weekEnd = moment().endOf('isoWeek').format('YYYY-MM-DD');

  try {
    const todayBookings = await Booking.find({ date: todayDate }).populate('court_id');
    const todayProfit = todayBookings.reduce((sum, b) => sum + (b.court_id ? b.duration * b.court_id.price : 0), 0);
    const todayCount = todayBookings.length;

    const weekBookings = await Booking.find({
      date: { $gte: weekStart, $lte: weekEnd }
    }).populate('court_id');

    const weekProfit = weekBookings.reduce((sum, b) => sum + (b.court_id ? b.duration * b.court_id.price : 0), 0);
    const weekCount = weekBookings.length;

    const badmintonBookings = await Booking.find({ date: { $gte: todayDate } })
      .populate({
        path: 'court_id',
        match: { sport: 'Badminton' }
      })
      .sort({ date: 1, start_time: 1 })
      .limit(5);

    const pickleballBookings = await Booking.find({ date: { $gte: todayDate } })
      .populate({
        path: 'court_id',
        match: { sport: 'Pickleball' }
      })
      .sort({ date: 1, start_time: 1 })
      .limit(5);

    const badmintonUpcoming = badmintonBookings.filter(b => b.court_id).map(b => ({
      court_name: b.court_id.name,
      date: moment(b.date).format('ddd MMM DD YYYY'),
      start_time: b.start_time,
      end_time: b.end_time,
      customer_name: b.customer_name || 'Unknown'
    }));

    const pickleballUpcoming = pickleballBookings.filter(b => b.court_id).map(b => ({
      court_name: b.court_id.name,
      date: moment(b.date).format('ddd MMM DD YYYY'),
      start_time: b.start_time,
      end_time: b.end_time,
      customer_name: b.customer_name || 'Unknown'
    }));

    const courts = await Court.find({}, 'name sport price status');

    res.render('staff-dashboard', {
      username: username,
      todayDate: moment(todayDate).format('MMMM Do, YYYY'),
      todayBookingsCount: todayCount,
      todayTotalProfit: todayProfit,
      weekBookingsCount: weekCount,
      weekTotalProfit: weekProfit,
      badmintonUpcoming,
      pickleballUpcoming,
      courts
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
});

app.post('/staff/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/staff-login');
  });
});

app.get('/booking', async (req, res) => {
  const sport = req.query.sport || 'Badminton';
  try {
    const courts = await Court.find({ status: 'Available', sport: sport });
    res.render('booking', { courts, sport });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading booking page');
  }
});

app.get('/confirmation/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  try {
    const booking = await Booking.findById(bookingId).populate('court_id');
    if (!booking) {
      return res.status(404).send('Booking not found');
    }

    booking.formattedDate = new Date(booking.date).toISOString().split('T')[0];

    res.render('confirmation', { booking });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading confirmation');
  }
});


app.get('/booked-slots', async (req, res) => {
  const courtId = req.query.court_id;
  const date = req.query.date;

  if (!courtId || !date) {
    res.status(400).json([]);
    return;
  }

  try {
    const slots = await Booking.find({ court_id: courtId, date: date }, 'start_time end_time');
    res.json(slots);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.post('/book', async (req, res) => {
  const { court_id, date, start_time, duration, customer_name, email, phone } = req.body;

  const [startHour, startMinute] = start_time.split(':').map(Number);
  let endHour = startHour + parseInt(duration);
  let endMinute = startMinute;
  if (endHour >= 24) endHour = 23;
  const end_time =
    (endHour < 10 ? '0' : '') + endHour + ':' + (endMinute < 10 ? '0' : '') + endMinute;

  try {
    const totalHoursAgg = await Booking.aggregate([
      {
        $match: {
          date: date,
          $or: [{ email: email }, { phone: phone }]
        }
      },
      {
        $group: {
          _id: null,
          total_hours: { $sum: '$duration' }
        }
      }
    ]);
    const totalHours = totalHoursAgg[0] ? totalHoursAgg[0].total_hours : 0;
    const newTotal = totalHours + parseInt(duration);

    if (newTotal > 3) {
      return res.status(400).send('Booking limit exceeded. You can only book up to 3 hours per day.');
    }

    const overlaps = await Booking.find({
      court_id: court_id,
      date: date,
      start_time: { $lt: end_time },
      end_time: { $gt: start_time }
    });

    if (overlaps.length > 0) {
      return res.status(400).send('This time slot is already booked.');
    }

    const newBooking = new Booking({
      court_id,
      date,
      start_time,
      end_time,
      duration,
      customer_name,
      email,
      phone
    });

    await newBooking.save();
    res.redirect('/confirmation/' + newBooking._id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
