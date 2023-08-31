resource "google_compute_instance" "agenta" {
  name         = "agenta-compute-instance"
  machine_type = "e2-medium"
  zone         = "us-central1-a"

  # uncomment this in case you need to ssh into the instance
  # metadata = {
  #  ssh-keys = "YOUR_USERNAME:${file("~/.ssh/id_rsa.pub")}"
  # }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }

  network_interface {
    network = google_compute_network.ipv6net.id
    subnetwork = google_compute_subnetwork.ipv6subnet.id
    stack_type = "IPV4_IPV6"    
    access_config {
      nat_ip = google_compute_address.ipv4.address
      network_tier = "PREMIUM"
    }

    ipv6_access_config {
      network_tier  = "PREMIUM"
    }
  }

  // Apply the firewall rule to allow external IPs to access this instance
  tags = ["http-server"]

  # Some changes require full VM restarts
  # consider disabling this flag in production
  #   depending on your needs
  allow_stopping_for_update = true

}

# Create an IPV4 
resource "google_compute_address" "ipv4" {
  name = "agenta-ipv4-address"
}

# Create a network
resource "google_compute_network" "ipv6net" {
  provider = google
  name = "agenta-ipv6net"
  auto_create_subnetworks = false
}

# Create a subnet with IPv6 capabilities
resource "google_compute_subnetwork" "ipv6subnet" {
  provider          = google
  name              = "agenta-ipv6subnet"
  network           = google_compute_network.ipv6net.name
  ip_cidr_range     = "10.0.0.0/8"
  stack_type        = "IPV4_IPV6"
  ipv6_access_type  = "EXTERNAL"
}

# Allow SSH from all IPs (insecure, only recommended for testing)
resource "google_compute_firewall" "http-server" {
  provider = google
  name    = "agenta-firewall"
  network = google_compute_network.ipv6net.name

  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "icmp"  # ICMP traffic (ping)
  }

  allow {
    protocol = "tcp"
    ports    = ["22"]  # SSH port
  }

  allow {
    protocol = "tcp"
    ports    = ["80"]  # HTTP port
  }

  allow {
    protocol = "tcp"
    ports    = ["443"]  # HTTPS port
  }
}

output "open_in_browser_this_link" {
  value = "\n Open the link below in your browser to access Agenta: ${google_compute_instance.agenta.network_interface.0.access_config.0.nat_ip}"
}