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

const OWNER_DELETE_PASSWORD = process.env.OWNER_DELETE_PASSWORD;

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
  const todayDay = moment().format('dddd'); // e.g., "Monday", "Tuesday", etc.
  const weekStart = moment().startOf('isoWeek').format('YYYY-MM-DD');
  const weekEnd = moment().endOf('isoWeek').format('YYYY-MM-DD');

  try {
    const todayBookings = await Booking.find({ date: todayDate }).populate('court_id');
    const todayProfit = todayBookings.reduce((sum, b) => sum + (b.court_id ? b.duration * b.court_id.price : 0), 0);
    const todayCount = todayBookings.length;
    // Define the hour labels you want, e.g. 8 AM to 9 PM
    const todayHourLabels = [];
    for (let h = 8; h <= 21; h++) {
      let label = h <= 12 ? `${h}am` : `${h - 12}pm`;
      todayHourLabels.push(label);
    }

    // Initialize counts array with zeros for each hour slot
    const todayBookingCounts = new Array(todayHourLabels.length).fill(0);

    // Count how many bookings start in each hour slot
    todayBookings.forEach(b => {
      if (b.start_time) {
        // Assume start_time is "HH:mm" string
        const hour = parseInt(b.start_time.split(':')[0], 10);
        // We only count if hour is between 8 and 21 inclusive
        if (hour >= 8 && hour <= 21) {
          const index = hour - 8;
          todayBookingCounts[index]++;
        }
      }
    });

    const weekBookings = await Booking.find({
      date: { $gte: weekStart, $lte: weekEnd }
    }).populate('court_id');

    const weekProfit = weekBookings.reduce((sum, b) => sum + (b.court_id ? b.duration * b.court_id.price : 0), 0);
    const weekCount = weekBookings.length;

    const profitByDay = {};

    for (let i = 0; i < 7; i++) {
      const date = moment(weekStart).add(i, 'days').format('YYYY-MM-DD');
      profitByDay[date] = 0;
    }

    weekBookings.forEach(b => {
      if (b.court_id) {
        profitByDay[b.date] += b.duration * b.court_id.price;
      }
    });

    const profitChartLabels = Object.keys(profitByDay).map(d => moment(d).format('ddd'));
    const profitChartData = Object.values(profitByDay);

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
      todayDay,
      todayBookingsCount: todayCount,
      todayTotalProfit: todayProfit,
      weekBookingsCount: weekCount,
      weekTotalProfit: weekProfit,
      badmintonUpcoming,
      pickleballUpcoming,
      courts,
      profitChartLabels,
      profitChartData,
      todayHourLabels,      // <-- pass labels
      todayBookingCounts,   // <-- pass counts
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
});

// View and manage courts in one page
app.get('/staff/courts', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/staff-login');
  }

  try {
    const courts = await Court.find({});
    res.render('staff-courts', { courts });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading courts');
  }
});

// Add or update court
app.post('/staff/courts/save', async (req, res) => {
  const { courtId, name, sport, price, status } = req.body;

  try {
    if (courtId) {
      // Edit existing court
      await Court.findByIdAndUpdate(courtId, { name, sport, price, status });
    } else {
      // Add new court
      const newCourt = new Court({ name, sport, price, status });
      await newCourt.save();
    }

    res.redirect('/staff/courts');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving court');
  }
});

app.post('/staff/courts/delete', async (req, res) => {
  const { courtId } = req.body;

  try {
    await Court.findByIdAndDelete(courtId);
    res.redirect('/staff/courts');
  } catch (err) {
    console.error('Error deleting court:', err);
    res.status(500).send('Error deleting court');
  }
});

// Staff bookings route with optional query params for date and search
app.get('/staff/bookings', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/staff-login');
  }

  const dateFilter = req.query.date || ''; // No default date filter
  const search = req.query.search ? req.query.search.trim() : '';

  try {
    // Build query with search first
    const query = {
      $or: [
        { customer_name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { phone: new RegExp(search, 'i') }
      ]
    };

    // Add date filter only if dateFilter is not empty
    if (dateFilter) {
      query.date = dateFilter;
    }

    const bookingsRaw = await Booking.find(query).populate('court_id').lean();

    const now = new Date();
    const bookings = bookingsRaw.map(b => {
      const startDateTime = new Date(`${b.date}T${b.start_time}:00`);
      let timeUntil = '';

      const diffMs = startDateTime - now;
      if (diffMs > 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        timeUntil = (hrs > 0 ? `${hrs}h ` : '') + `${mins}m left`;
      } else {
        timeUntil = 'Started/Past';
      }

      return { ...b, timeUntil };
    });

    res.render('staff-bookings', {
      bookings,
      filterDate: dateFilter,
      search
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bookings');
  }
});

app.post('/staff/bookings/delete-all', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/staff-login');
  }

  const enteredPassword = req.body.password;

  if (enteredPassword !== OWNER_DELETE_PASSWORD) {
    return res.status(403).send('Invalid password. Deletion not authorized.');
  }

  try {
    await Booking.deleteMany({});
    res.redirect('/staff/bookings');
  } catch (err) {
    console.error('Error deleting all bookings:', err);
    res.status(500).send('Failed to delete bookings.');
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
    // === ADD THIS CHECK ===
    const today = new Date();
    today.setHours(0, 0, 0, 0); // midnight today
    const bookingDate = new Date(date);
    bookingDate.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      return res.status(400).send('Cannot book past dates.');
    }
    // ======================

    // Build match query depending on email/phone presence
    let matchQuery = { date: date };

    if (email && phone) {
      matchQuery.$or = [{ email: email }, { phone: phone }];
    } else if (email) {
      matchQuery.email = email;
    } else if (phone) {
      matchQuery.phone = phone;
    } else {
      // No email or phone provided - skip limit check or handle error here if you want
      matchQuery = null;
    }

    let totalHours = 0;
    if (matchQuery) {
      const totalHoursAgg = await Booking.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total_hours: { $sum: '$duration' } } }
      ]);
      totalHours = totalHoursAgg[0] ? totalHoursAgg[0].total_hours : 0;
    }

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
