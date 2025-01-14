import express from 'express'

const app = express();


app.post('/moralis/webhook', async (req, res) => {
    console.log(req.body);
    res.status(200).send('Webhook received');
});


app.listen(3000, () => {
    console.log('Server is running on port 3000');
});