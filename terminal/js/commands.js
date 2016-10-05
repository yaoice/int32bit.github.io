var all_posts = get_posts();
function do_help(args)
{
    var help = "Keyboard Shortcuts: <br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + L</span>" + "&nbsp;".repeat(4) + "Clears the Screen, similar to the 'clear' command.</br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + H</span>" + "&nbsp;".repeat(4) + "Delete character before the cursor, same as backspace.</br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + U</span>" + "&nbsp;".repeat(4) + "Clears the line before the cursor position.</br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + P</span>" + "&nbsp;".repeat(4) + "Previous command in history.</br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + N</span>" + "&nbsp;".repeat(4) + "Next command in history.</br/>";
    help += "&nbsp;".repeat(4) + "<span class='dir'>Ctrl + D</span>" + "&nbsp;".repeat(4) + "Exit the terminal.</br/>";

    help += "Available Commands: <br/>";
    for (i in commands) {
        help += "<span class='dir'>" + i + "</span> ";
    }
    return help;
}

function do_pwd(args)
{
    return "<span class='dir'>/beijing/polex</span>";
}

function do_top(args)
{
    return do_ls();
}

function do_ls(args)
{
    if ($.inArray("-l", args) != -1) {
        return do_ll(args);
    }
    var all = false;
    if ($.inArray("-a", args) != -1) {
        all = true;
    }
    var posts = all_posts;
    var output = "";
    for (var i in posts) {
        output += "<a href='" + posts[i].url + "' class='dir' target='blank'>" + posts[i].title + "</a><br/>";
        if (! all && i > 8)
            break;
    }
    return output;
}

function do_ll(args)
{
    var posts = all_posts;
    var output = "total " + posts.length + "<br/>";
    for (var i in posts) {
        var author = posts[i].author || "int32bit";
        var title = posts[i].title;
        var date = posts[i].date.slice(0, 10);
        var group = posts[i].group || "admin";
        var size = paddingLeft(posts[i].size, 5, "&nbsp;");
        var url = posts[i].url;
        output += "-rw-r--r-- ";
        output += size + " ";
        output += author + " ";
        output += group + " ";
        output += date + " ";
        output += "<a class='dir' target='blank' href='" + url + "' >" + posts[i].title + "</a> ";
        output += "<br/>";
    }
    return output;
}

function do_cd(args)
{
    return "Not Implemented.";
}

function do_about(args)
{
    return "fgp";
}

function do_whoami(args)
{
    return do_about(args);
}

function do_date(args)
{
    return new Date();
}

function do_clear(args)
{
    $(".output").remove();
    return "";
}

function do_groups(args)
{
    var groups = ["Linux", "Openstack", "Docker", "Ceph", "K8s", "Spark"];
    var output = "";
    for (var i in groups) {
        output += "<span class='highlight'>" + groups[i] + "</span>&nbsp;&nbsp;";
    }
    return output;
}

function do_history(args)
{
    var h = ""
    for (var i in history_list) {
        h += "<div>" + i + "&nbsp;&nbsp;" + history_list[i] + "</div>";
    }
    return h;
}

function do_close(args)
{
    
    window.open('','_self').close();
    return "";
}

function do_echo(args, input)
{
    var input = input.slice("echo".length).trim(); // trim is self-defined function
    input = input.replace(/^"/, "").replace(/"$/, "");
    input = input.replace(/^'/, "").replace(/'$/, "");
    return input;
}

function do_index(args)
{
    window.location = "/";
    return "";
}

function do_back(args)
{
    history.go(-1);
    return "";
}

function do_eval(args)
{
    return eval(args.toString()) || "0";
}

function do_weibo(args)
{
    return open_url("http://weibo.com/316378881");
}

function do_github(args)
{
    return open_url("https://github.com/int32bit");
}

function do_zhihu(args)
{
    return open_url("https://www.zhihu.com/people/int32bit");
}

function do_twitter(args)
{
    return open_url("https://twitter.com/int32bit");
}

function do_exit(args)
{
    $("#terminal").fadeOut("slow");
    return "";
}

function do_reload(args)
{
    top.location.reload();
    return "";
}

function do_background(args)
{
    changeBackground();
    return "";
}

function do_dirs(args)
{
    var output = "";
    output += "<span class='exec'>a.out</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class='const'>bg.png</span>&nbsp;&nbsp;&nbsp;&nbsp;";
    output += "<span class='dir'>css</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class='nornal'>helloworld.c</span>&nbsp;&nbsp;&nbsp;&nbsp;";
    output += "<span class='nornal'>index.html</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class='dir'>js</span>&nbsp;&nbsp;&nbsp;&nbsp;";
    return output;
}
