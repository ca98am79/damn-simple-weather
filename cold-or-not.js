require('date-utils');
var express = require('express');
var request = require('request');
var xml_parser = require('libxml-to-js');

var app = express.createServer();
app.use(express.logger());
app.use(express.cookieParser());
app.set("view engine", "ejs");
app.use("/css", express.static(__dirname + '/css'));

var cache = {
  date: Date.today()
};

function NOAA_weather_api_str(zip) {
    return "http://graphical.weather.gov/xml/sample_products/browser_interface/ndfdXMLclient.php?zipCodeList=" +
        zip + "&product=time-series&begin=" + Date.today().toFormat("YYYY-MM-DD") +
        "&end=" + Date.tomorrow().toFormat("YYYY-MM-DD") + "&maxt=maxt&mint=mint&pop12=pop12";
}

app.get('/', function(req, res){
    var zip_code = null;

    if (req.query.new) {
  	res.clearCookie('zip_code');
    } else if (req.query.zip) {
	zip_code = req.query.zip;
        var expire_date = new Date();
	expire_date.setDate(expire_date.getDate() + 30);
	res.cookie('zip_code', zip_code, { expires: expire_date });
    } else {
    	zip_code = req.cookies.zip_code;
    }

    if(zip_code) {
        get_weather(res, zip_code, render_weather);
    } else {
        res.render("index.ejs");
    }
});

app.get('/:zip', function(req, res){
    if (isNumber(req.params.zip)) {
        get_weather(res, req.params.zip, render_weather);
    } else {
        res.render("index.ejs");
    }
});

function render_weather(zip, res, error, weather) {
    if(Date.compare(Date.today(), cache.date) !== 0) {
        cache = {
          date: Date.today()
        };
    }
    if(error) {
        res.clearCookie('zip_code');
        console.log(error);
        res.send(error);
    } else {
	var coldness = 'Cold';
	var coldclass = 'cold';
	var temp = weather.temp ? weather.temp : weather.min_temp;
	if (temp >= 50) {
		coldness = 'Not cold';
		coldclass = 'notcold';
	} else if (temp > 40) {
		coldness = 'Kind of cold';
	}
        res.render("weather_for_zip", {
          weather: weather,
          zip: zip,
          today: Date.today().toFormat("YYYY-MM-DD"),
	  coldness: coldness,
	  coldclass: coldclass
        });
    }
}

function get_weather(res, zip, callback) {
    if(cache["z" + zip] !== undefined) {
        //console.log("cache hit");
        callback(zip, res, null, cache["z" + zip]);
    } else if (isNumber(zip)) {
        request(NOAA_weather_api_str(zip), function (error, response, body) {
            if(!error && response.statusCode == 200) {
                xml_parser(body, function (parser_error, result) {
                    if(parser_error) {
                        callback(zip, res, parser_error);
                    } else if(result.error) {
                        callback(zip, res, result.error);
                    } else if(result && result.data) {
                        //console.log("cache miss");
                        weather = parse_NOAA_response(result);
                        cache["z" + zip] = weather;
                        callback(zip, res, null, weather);
                    } else {
                        callback(zip, res, "Zip code not found");
                    }
                });
            } else {
                callback(zip, res, "There was an error" + error);
            }
        });
    } else {
        callback(zip, res, "Zip code not found");
    }
}

function parse_NOAA_response(response) {
    var resp_precip_obj = response.data.parameters["probability-of-precipitation"].value;
    var resp_temperature_obj = response.data.parameters["temperature"];

    var precip_prob_obj = {
        precip: 0
    };
    if(is_array(resp_precip_obj)) {
        var precip_count = 0;
        for(var i = 0; i < resp_precip_obj.length; i++){
            precip_chance = parseInt(resp_precip_obj[i]["#"]);
            precip_prob_obj["precip"] += precip_chance;
            precip_count++;
        }
        precip_prob_obj["precip"] = Math.round(precip_prob_obj["precip"] / precip_count);
    } else {
        precip_prob_obj["precip"] = resp_precip_obj;
    }

    var temperature_obj = {};
    if(is_array(resp_temperature_obj)) {
        temperature_obj["min_temp"] = 0;
        temperature_obj["max_temp"] = 0;

        for(var i = 0; i < resp_temperature_obj.length; i++) {
            temp_value = resp_temperature_obj[i];

            var temp_to_adjust;
            var temp_count = 0;

            if(temp_value.name === "Daily Minimum Temperature") {
                temp_to_adjust = "min_temp";
            } else if(temp_value.name === "Daily Maximum Temperature") {
                temp_to_adjust = "max_temp";
            } else {
                continue;
            }

            if(is_array(temp_value.value)) {
                temp_value = temp_value.value;
                for(var j = 0; j < temp_value.length; j++) {
                    temperature_obj[temp_to_adjust] += parseInt(temp_value[j]["#"]);
                    temp_count++;
                }
                temperature_obj[temp_to_adjust] = temp_count === 0 ? undefined : Math.round(temperature_obj[temp_to_adjust] / temp_count);
            } else {
                temperature_obj[temp_to_adjust] = parseInt(temp_value.value);
            }
        }
    } else {
        temperature_obj["temp"] = parseInt(resp_temperature_obj.value);
    }

    return merge_objects(temperature_obj, precip_prob_obj);
}

function is_array(obj) {
    return obj.shift ? true : false;
}

function merge_objects(obj1, obj2) {
    var obj3 = {};
    for (var attrname in obj1) { obj3[attrname] = obj1[attrname]; }
    for (var attrname in obj2) { obj3[attrname] = obj2[attrname]; }
    return obj3;
}

function isNumber (o) {
  return ! isNaN (o-0) && o != null;
}

app.listen(process.env.PORT || 80);

