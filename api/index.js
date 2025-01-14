import express from 'express'

const app = express();

app.get('/api', (req, res) => {
    res.status(200).json({ message: 'Hello from API' });
});

app.post('/moralis/webhook', (req, res) => {
    console.log(req.body);
    res.status(200).json({ message: 'Webhook is running, ready to start implementing logic.' });
});


app.listen(3000, () => {
    console.log('Server is running on port 3000');
});