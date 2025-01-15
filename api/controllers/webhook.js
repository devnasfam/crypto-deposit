export const webhook = async (req, res) => {
    console.log(req.body);
    res.status(200).json({ message: 'Webhook is running, ready to start implementing logic.' });
}