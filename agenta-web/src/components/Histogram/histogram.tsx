import React from 'react';
import { Bar } from 'react-chartjs-2'
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);


const Histogram = ({ data  }:any) => {
    const chartData = {
        labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        datasets: [
            {
                label: 'Grade Distribution',
                data: data,
                backgroundColor: 'rgba(75, 192, 192, 0.6)', // Adjust color as needed
            },
        ],
    };
    const maxY = Object.values(data).reduce((total:number, value:any) => total + value, 0)
    const chartOptions = {
        scales: {
            y: {
                beginAtZero: true,
                max: maxY +5, // Adjust max value for y-axis
            },
        },
    };
    

    return (
        <div >
            <h3>Grade Distribution Histogram</h3>
            <Bar data={chartData} options={chartOptions} />
        </div>
    );
};

export default Histogram;
