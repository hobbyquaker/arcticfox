const fox = require('./index.js');

let interval;

fox.on('connect', () => {
    //console.log('connect');
/*
    Interval = setInterval(() => {
        fox.readMonitoringData((err, data) => {
            console.log(err, data);
        });
    }, 200);



 */

/*
    fox.screenshot((err, data) => {
        console.log(data);
    });


    console.log(fox.setDateTime(new Date()));
    fox.readMonitoringData((err, data) => {
        console.log(err, data);
    });

 */
    //fox.setDateTime(new Date());
    fox.readConfiguration((err, data) => {
        console.log(JSON.stringify(data, null, '  '));
    });



});

fox.on('error', err => {
    console.log(err.message);
});

fox.on('close', () => {
    console.log('close');
    clearInterval(interval);
});

fox.connect();
