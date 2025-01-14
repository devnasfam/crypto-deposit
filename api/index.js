import express from 'express'
import bodyParser from 'body-parser';
const app = express();
app.use(bodyParser.json());

app.get('/api', (req, res) => {
    res.status(200).json({ message: 'Hello from API' });
});

app.post('/api/moralis', (req, res) => {
    console.log(req.body);
    res.status(200).json({ message: 'Webhook is running, ready to start implementing logic.' });
});


app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port 3000');
});