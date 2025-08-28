import { bandCountsOut } from "./map.js"; 

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("chartBtn").addEventListener("click", () => {
    const bandColorMap = {
      '160m': 'black',
      '80m': 'red',
      '60m': 'orange-dark',
      '40m': 'orange',
      '30m': 'yellow',
      '20m': 'green',
      '17m': 'green-light',
      '15m': 'cyan',
      '12m': 'blue-dark',
      '10m': 'blue-dark',
      '6m': 'purple',
      '4m': 'violet',
      '2m': 'pink',
      '70cm': 'white',
      'unknown': 'green-dark'
    };
    
    const colorHexMap = {
      "red": "991F24",
      "orange-dark": "D43019",
      "orange": "EE8918",
      "yellow": "F5B72D",
      "blue-dark": "183C52",
      "blue": "106AB6",
      "cyan": "21A2DA",
      "purple": "4E2960",
      "violet": "8B1E89",
      "pink": "BB4A99",
      "green-dark": "004B22",
      "green": "008B38",
      "green-light": "5AA429",
      "black": "211D1E",
      "white": "F5F4F5"
    };

    const labels = Object.keys(bandCountsOut);
    const values = Object.values(bandCountsOut);
    const colors = labels.map(label => {
      const colorKey = bandColorMap[label] || 'unknown';
      const hex = colorHexMap[colorKey] || '000000';
      return `#${hex}`;
    });

    // Escape all for inline JS
    const labelsJSON = JSON.stringify(labels);
    const valuesJSON = JSON.stringify(values);
    const colorsJSON = JSON.stringify(colors);

    const chartWindow = window.open("", "ChartWindow", "width=900,height=700");

    chartWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pie Chart of Bands Received</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <canvas id="PieChart" width="300" height="300"></canvas>
        <script>
          const ctx = document.getElementById('PieChart').getContext('2d');
          const labels = ${labelsJSON};
          const values = ${valuesJSON};
          const backgroundColors = ${colorsJSON};

          const data = {
            labels: labels,
            datasets: [{
              label: 'Band Activity',
              data: values,
              backgroundColor: backgroundColors,
              borderColor: 'white',
              borderWidth: 1
            }]
          };

          const config = {
            type: 'pie',
            data: data,
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: 'bottom'
                }
              }
            }
          };

          new Chart(ctx, config);
        <\/script>
      </body>
      </html>
    `);
  });
});
